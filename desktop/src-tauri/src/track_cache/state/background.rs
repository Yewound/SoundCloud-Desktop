use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::Manager;
use tokio::sync::{Notify, OwnedSemaphorePermit};

use super::TrackCacheState;
use crate::auth::SessionStore;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Playback,
    Background,
    Bulk,
}

#[derive(Default)]
pub(super) struct BackgroundQueue {
    waiting: AtomicUsize,
    changed: Notify,
}

struct Waiting<'a>(&'a BackgroundQueue);

impl<'a> Waiting<'a> {
    fn join(queue: &'a BackgroundQueue) -> Self {
        queue.waiting.fetch_add(1, Ordering::SeqCst);
        queue.changed.notify_waiters();
        Self(queue)
    }
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.waiting.fetch_sub(1, Ordering::SeqCst);
        self.0.changed.notify_waiters();
    }
}

impl TrackCacheState {
    pub(super) async fn background_turn(
        &self,
        playback_joined: &Notify,
        bulk: bool,
    ) -> Option<OwnedSemaphorePermit> {
        if self.premium().await {
            return None;
        }
        let turn = async {
            if bulk {
                self.bulk_turn().await
            } else {
                let _waiting = Waiting::join(&self.background_queue);
                self.background_hq_limiter
                    .clone()
                    .acquire_owned()
                    .await
                    .ok()
            }
        };
        tokio::select! {
            permit = turn => permit,
            () = playback_joined.notified() => None,
        }
    }

    async fn bulk_turn(&self) -> Option<OwnedSemaphorePermit> {
        let queue = &self.background_queue;
        loop {
            let changed = queue.changed.notified();
            if queue.waiting.load(Ordering::SeqCst) > 0 {
                changed.await;
                continue;
            }
            tokio::select! {
                biased;
                () = changed => {}
                permit = self.background_hq_limiter.clone().acquire_owned() => return permit.ok(),
            }
        }
    }

    async fn premium(&self) -> bool {
        let Some(app) = self.app_handle.as_ref() else {
            return false;
        };
        match app.try_state::<Arc<SessionStore>>() {
            Some(store) => store.premium().await,
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::Notify;
    use tokio::time::timeout;

    use super::super::tests::test_state;

    const QUEUED: Duration = Duration::from_millis(50);

    #[tokio::test]
    async fn background_hq_asks_take_turns_and_a_joining_playback_skips_the_queue() {
        let (root, state) = test_state("background-turn");
        let first = state.background_turn(&Notify::new(), false).await;
        assert!(first.is_some());

        let playback_joined = Notify::new();
        let second = state.background_turn(&playback_joined, false);
        tokio::pin!(second);
        assert!(timeout(QUEUED, &mut second).await.is_err());
        playback_joined.notify_one();
        assert!(second.await.is_none());

        let joined_early = Notify::new();
        joined_early.notify_one();
        assert!(state.background_turn(&joined_early, false).await.is_none());

        drop(first);
        assert!(state.background_turn(&Notify::new(), false).await.is_some());
        std::fs::remove_dir_all(root).ok();
    }

    #[tokio::test]
    async fn previews_and_preloads_go_ahead_of_queued_bulk_saves() {
        let (root, state) = test_state("background-bulk");
        let first = state.background_turn(&Notify::new(), true).await;
        assert!(first.is_some());

        let nobody_joins = Notify::new();
        let bulk = state.background_turn(&nobody_joins, true);
        tokio::pin!(bulk);
        assert!(timeout(QUEUED, &mut bulk).await.is_err());

        let preview = state.background_turn(&nobody_joins, false);
        tokio::pin!(preview);
        assert!(timeout(QUEUED, &mut preview).await.is_err());

        drop(first);
        assert!(timeout(QUEUED, &mut bulk).await.is_err());
        let preview = timeout(QUEUED, &mut preview).await.unwrap();
        assert!(preview.is_some());
        assert!(timeout(QUEUED, &mut bulk).await.is_err());

        drop(preview);
        assert!(timeout(QUEUED, &mut bulk).await.unwrap().is_some());
        std::fs::remove_dir_all(root).ok();
    }
}
