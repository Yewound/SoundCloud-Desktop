use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use super::{
    CacheRequest, PlaybackQuality, RaceJob, TrackCacheState, is_valid_file, read_cache_metadata,
};

pub(super) fn upgrades_existing(existing: &Path, incoming: PlaybackQuality) -> bool {
    let current = read_cache_metadata(existing)
        .map(|m| m.quality)
        .unwrap_or(PlaybackQuality::Sq);
    incoming.rank() > current.rank()
}

fn reachable(storage_quality: Option<&str>) -> PlaybackQuality {
    match PlaybackQuality::stored_as(storage_quality) {
        PlaybackQuality::Uq => PlaybackQuality::Uq,
        _ => PlaybackQuality::Hq,
    }
}

impl TrackCacheState {
    pub async fn upgrade_cached(&self, req: CacheRequest<'_>) -> bool {
        let urn = req.urn;
        let Some(clean) = self.resolve_clean_path(urn) else {
            return false;
        };
        let entry = self.entry_at(&clean, read_cache_metadata(&clean));
        let current = PlaybackQuality::stored_as(entry.quality.as_deref());
        if current.rank() >= reachable(req.storage_quality).rank()
            || entry.accepted_short
            || self.ffmpeg().is_none()
            || is_valid_file(&self.incoming_file_path(urn))
            || !self.claim_upgrade(urn)
        {
            return false;
        }

        let Some(path) = self.download_better(&req, current).await else {
            self.diag(
                "INFO",
                format!(
                    "[TrackCache] no source above {} to upgrade {urn}",
                    current.label()
                ),
            );
            return false;
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

    async fn download_better(
        &self,
        req: &CacheRequest<'_>,
        current: PlaybackQuality,
    ) -> Option<PathBuf> {
        let start = Instant::now();
        let target_dir = self.incoming_dir.as_path();
        let stored = PlaybackQuality::stored_as(req.storage_quality);
        if stored.rank() > current.rank() {
            let storage = self.storage_job(target_dir, req.urn, req.storage_urls, stored, start);
            if let Some(path) = self.try_storage(&storage).await {
                return Some(path);
            }
        }
        if req.urls.is_empty() && req.download_urls.is_empty() {
            return None;
        }
        let job = RaceJob {
            target_dir,
            urn: req.urn,
            session_id: req.session_id,
            hq: true,
            start,
            receiving: Arc::new(AtomicBool::new(false)),
        };
        self.race_direct_and_api(&job, req.download_urls, req.urls)
            .await
            .ok()
    }
}
