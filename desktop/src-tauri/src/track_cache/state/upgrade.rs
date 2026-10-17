use std::path::Path;

use tokio::sync::Notify;

use super::ladder::Ladder;
use super::{CacheRequest, PlaybackQuality, TrackCacheState, is_valid_file, read_cache_metadata};

pub(super) fn upgrades_existing(existing: &Path, incoming: PlaybackQuality) -> bool {
    let current = read_cache_metadata(existing)
        .map(|m| m.quality)
        .unwrap_or(PlaybackQuality::Sq);
    incoming.rank() > current.rank()
}

impl TrackCacheState {
    pub async fn upgrade_cached(&self, req: CacheRequest<'_>) -> bool {
        let urn = req.urn;
        let Some(clean) = self.resolve_clean_path(urn) else {
            return false;
        };
        let entry = self.entry_at(&clean, read_cache_metadata(&clean));
        let current = PlaybackQuality::from_label(entry.quality.as_deref());
        let wanted = self.allowed_quality(req.quality, req.session_id);
        if current.rank() >= wanted.rank()
            || entry.accepted_short
            || self.ffmpeg().is_none()
            || is_valid_file(&self.incoming_file_path(urn))
            || !self.claim_upgrade(urn)
        {
            return false;
        }

        let nobody_joins = Notify::new();
        let climbed = self
            .climb(Ladder {
                target_dir: self.incoming_dir.as_path(),
                urn,
                urls: req.urls,
                download_urls: req.download_urls,
                storage_urls: req.storage_urls,
                session_id: req.session_id,
                wanted,
                stored: PlaybackQuality::from_label(req.storage_quality),
                above: Some(current),
                background: Some(&nobody_joins),
            })
            .await;
        let path = match climbed {
            Ok(path) => path,
            Err(err) => {
                if self.allowed_quality(wanted, req.session_id).rank() < wanted.rank() {
                    self.release_upgrade(urn);
                }
                self.diag(
                    "INFO",
                    format!(
                        "[TrackCache] nothing above {} for {urn}: {err}",
                        current.label()
                    ),
                );
                return false;
            }
        };
        let served = read_cache_metadata(&path)
            .map(|m| m.quality)
            .unwrap_or(PlaybackQuality::Sq);
        if served.rank() <= current.rank() {
            self.remove_incoming(urn).await;
            self.diag(
                "INFO",
                format!(
                    "[TrackCache] upgrade for {urn} served {}, already had {}",
                    served.label(),
                    current.label()
                ),
            );
            return false;
        }

        let liked = entry.pinned;
        self.finalize_incoming(&path, liked, req.expected_duration_ms.filter(|&ms| ms > 0))
            .await;
        self.spawn_transcode(urn.to_string());
        self.diag(
            "INFO",
            format!("[TrackCache] upgrading {urn} to {}", served.label()),
        );
        true
    }

    fn claim_upgrade(&self, urn: &str) -> bool {
        self.upgrade_attempts
            .lock()
            .is_ok_and(|mut set| set.insert(urn.to_string()))
    }

    fn release_upgrade(&self, urn: &str) {
        if let Ok(mut set) = self.upgrade_attempts.lock() {
            set.remove(urn);
        }
    }
}
