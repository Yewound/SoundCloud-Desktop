use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::{Notify, OnceCell, OwnedSemaphorePermit};

use super::storage::StorageJob;
use super::{HQ_ANON_BACKUP_SECS, PlaybackQuality, RaceJob, TrackCacheState};
use crate::track_cache::api_download::tier_url;
use crate::track_cache::direct_download::Candidate;

pub(super) struct Ladder<'a> {
    pub target_dir: &'a Path,
    pub urn: &'a str,
    pub urls: &'a [String],
    pub download_urls: &'a [String],
    pub storage_urls: &'a [String],
    pub session_id: Option<&'a str>,
    pub wanted: PlaybackQuality,
    pub stored: PlaybackQuality,
    pub above: Option<PlaybackQuality>,
    pub background: Option<&'a Notify>,
}

struct Climb<'a> {
    ladder: &'a Ladder<'a>,
    storage: &'a StorageJob<'a>,
    candidates: &'a [OnceCell<Vec<Candidate>>; 3],
    receiving: &'a Arc<AtomicBool>,
    turn_taken: &'a Notify,
    start: Instant,
}

impl Climb<'_> {
    fn candidates_at(&self, tier: PlaybackQuality) -> &OnceCell<Vec<Candidate>> {
        &self.candidates[usize::from(tier.rank())]
    }
}

const UPPER_TIERS: [PlaybackQuality; 2] = [PlaybackQuality::Uq, PlaybackQuality::Hq];

fn upper_tiers(wanted: PlaybackQuality, above: PlaybackQuality) -> Vec<PlaybackQuality> {
    UPPER_TIERS
        .into_iter()
        .filter(|tier| tier.rank() <= wanted.rank() && tier.rank() > above.rank())
        .collect()
}

fn download_urls_at(urls: &[String], tier: PlaybackQuality) -> Vec<String> {
    match tier {
        PlaybackQuality::Uq => Vec::new(),
        PlaybackQuality::Hq | PlaybackQuality::Sq => {
            urls.iter().map(|url| tier_url(url, tier)).collect()
        }
    }
}

async fn silent_too_long(climb: &Climb<'_>) {
    if climb.ladder.background.is_some() {
        climb.turn_taken.notified().await;
    }
    tokio::time::sleep(Duration::from_secs(HQ_ANON_BACKUP_SECS)).await;
}

impl TrackCacheState {
    pub(super) async fn climb(&self, ladder: Ladder<'_>) -> Result<PathBuf, String> {
        let tiers = upper_tiers(ladder.wanted, ladder.above.unwrap_or(PlaybackQuality::Sq));
        let start = Instant::now();
        let storage = self.storage_job(
            ladder.target_dir,
            ladder.urn,
            ladder.storage_urls,
            ladder.stored,
            start,
        );
        let candidates = Default::default();
        let receiving = Arc::new(AtomicBool::new(false));
        let turn_taken = Notify::new();
        let climb = Climb {
            ladder: &ladder,
            storage: &storage,
            candidates: &candidates,
            receiving: &receiving,
            turn_taken: &turn_taken,
            start,
        };

        let upper = self.climb_upper(&climb, &tiers);
        if ladder.above.is_some() {
            return upper.await;
        }
        let storage_in_upper = tiers.iter().any(|tier| ladder.stored.rank() >= tier.rank());
        let lower = self.climb_sq(&climb, !storage_in_upper);
        if tiers.is_empty() {
            return lower.await;
        }
        self.with_backup(&climb, upper, lower).await
    }

    async fn climb_upper(
        &self,
        climb: &Climb<'_>,
        tiers: &[PlaybackQuality],
    ) -> Result<PathBuf, String> {
        let mut storage_tried = false;
        let mut turn = None;
        let mut last_err = String::from("no tier above sq asked");
        for &tier in tiers {
            if !storage_tried && climb.ladder.stored.rank() >= tier.rank() {
                storage_tried = true;
                if let Some(path) = self.try_storage(climb.storage).await {
                    return Ok(path);
                }
            }
            if turn.is_none() {
                turn = Some(self.streaming_turn(climb).await);
            }
            if self.allowed_quality(tier, climb.ladder.session_id).rank() < tier.rank() {
                last_err = format!("{}: refused", tier.label());
                continue;
            }
            match self.streaming_at(climb, tier).await {
                Ok(path) => return Ok(path),
                Err(err) => last_err = format!("{}: {err}", tier.label()),
            }
        }
        Err(last_err)
    }

    async fn streaming_turn(&self, climb: &Climb<'_>) -> Option<OwnedSemaphorePermit> {
        let turn = match climb.ladder.background {
            Some(playback_joined) => self.background_turn(playback_joined).await,
            None => None,
        };
        climb.turn_taken.notify_one();
        turn
    }

    async fn climb_sq(&self, climb: &Climb<'_>, with_storage: bool) -> Result<PathBuf, String> {
        let Ladder {
            target_dir, urn, ..
        } = *climb.ladder;
        if with_storage && let Some(path) = self.try_storage_redirect(climb.storage).await {
            return Ok(path);
        }
        let mut anon_err = None;
        match self.try_anon(target_dir, urn, climb.start).await {
            Ok(Some(path)) => return Ok(path),
            Ok(None) => {}
            Err(e) => anon_err = Some(format!("anon: {e}")),
        }
        if with_storage && let Some(path) = self.try_storage_stream(climb.storage).await {
            return Ok(path);
        }
        self.streaming_at(climb, PlaybackQuality::Sq)
            .await
            .map_err(|err| match anon_err {
                Some(anon) => format!("{anon}; {err}"),
                None => err,
            })
    }

    async fn streaming_at(
        &self,
        climb: &Climb<'_>,
        tier: PlaybackQuality,
    ) -> Result<PathBuf, String> {
        let ladder = climb.ladder;
        let download_urls = download_urls_at(ladder.download_urls, tier);
        if download_urls.is_empty() && ladder.urls.is_empty() {
            return Err("no stream URLs provided".into());
        }
        let session = crate::auth::session_token(self.app_handle.as_ref()).await;
        let job = RaceJob {
            target_dir: ladder.target_dir,
            urn: ladder.urn,
            session_id: session.as_deref().or(ladder.session_id),
            quality: tier,
            start: climb.start,
            receiving: climb.receiving.clone(),
            candidates: climb.candidates_at(tier),
        };
        self.race_direct_and_api(&job, &download_urls, ladder.urls)
            .await
    }

    async fn with_backup(
        &self,
        climb: &Climb<'_>,
        primary: impl Future<Output = Result<PathBuf, String>>,
        backup: impl Future<Output = Result<PathBuf, String>>,
    ) -> Result<PathBuf, String> {
        tokio::pin!(primary);
        tokio::pin!(backup);
        let finished = tokio::select! {
            res = &mut primary => Some(res),
            () = silent_too_long(climb) => None,
        };
        let urn = climb.ladder.urn;
        match finished {
            Some(Ok(path)) => Ok(path),
            Some(Err(_)) => backup.await,
            None if climb.receiving.load(Ordering::Relaxed) => match primary.await {
                Ok(path) => Ok(path),
                Err(_) => backup.await,
            },
            None => {
                self.diag(
                    "INFO",
                    format!(
                        "[TrackCache] quality sources still silent for {urn}, starting sq alongside"
                    ),
                );
                tokio::select! {
                    res = &mut primary => match res {
                        Ok(path) => Ok(path),
                        Err(_) => backup.await,
                    },
                    res = &mut backup => match res {
                        Ok(path) => Ok(path),
                        Err(err) => primary.await.map_err(|_| err),
                    },
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(tiers: Vec<PlaybackQuality>) -> Vec<&'static str> {
        tiers.into_iter().map(PlaybackQuality::label).collect()
    }

    #[test]
    fn the_ladder_starts_at_the_asked_tier_and_stops_above_the_floor() {
        use PlaybackQuality::{Hq, Sq, Uq};
        assert_eq!(labels(upper_tiers(Uq, Sq)), ["uq", "hq"]);
        assert_eq!(labels(upper_tiers(Hq, Sq)), ["hq"]);
        assert!(upper_tiers(Sq, Sq).is_empty());
        assert_eq!(labels(upper_tiers(Uq, Hq)), ["uq"]);
        assert!(upper_tiers(Hq, Hq).is_empty());
    }

    #[test]
    fn a_download_ask_names_its_tier_and_uq_skips_download() {
        use PlaybackQuality::{Hq, Sq, Uq};
        let urls = ["https://api.example/download/soundcloud%3Atracks%3A1".to_string()];
        assert_eq!(
            download_urls_at(&urls, Hq),
            ["https://api.example/download/soundcloud%3Atracks%3A1?hq=true&quality=hq"]
        );
        assert_eq!(
            download_urls_at(&urls, Sq),
            ["https://api.example/download/soundcloud%3Atracks%3A1?quality=sq"]
        );
        assert!(download_urls_at(&urls, Uq).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_queued_background_climb_counts_silence_only_from_its_turn() {
        let playback_joined = Notify::new();
        let ladder = Ladder {
            target_dir: Path::new("."),
            urn: "soundcloud:tracks:1",
            urls: &[],
            download_urls: &[],
            storage_urls: &[],
            session_id: None,
            wanted: PlaybackQuality::Hq,
            stored: PlaybackQuality::Sq,
            above: None,
            background: Some(&playback_joined),
        };
        let storage = StorageJob {
            target_dir: ladder.target_dir,
            urn: ladder.urn,
            urls: Vec::new(),
            quality: PlaybackQuality::Sq,
            start: Instant::now(),
        };
        let turn_taken = Notify::new();
        let climb = Climb {
            ladder: &ladder,
            storage: &storage,
            candidates: &Default::default(),
            receiving: &Arc::new(AtomicBool::new(false)),
            turn_taken: &turn_taken,
            start: Instant::now(),
        };
        let backup_secs = Duration::from_secs(HQ_ANON_BACKUP_SECS);

        let silence = silent_too_long(&climb);
        tokio::pin!(silence);
        let queued = tokio::time::timeout(backup_secs * 4, &mut silence).await;
        assert!(queued.is_err());
        turn_taken.notify_one();
        let early = tokio::time::timeout(backup_secs / 2, &mut silence).await;
        assert!(early.is_err());
        let silent = tokio::time::timeout(backup_secs, &mut silence).await;
        assert!(silent.is_ok());
    }
}
