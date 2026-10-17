use std::sync::Arc;

use tauri::Manager;
use tokio::sync::{Notify, OwnedSemaphorePermit};

use super::TrackCacheState;
use crate::auth::SessionStore;

impl TrackCacheState {
    pub(super) async fn background_turn(
        &self,
        playback_joined: &Notify,
    ) -> Option<OwnedSemaphorePermit> {
        if self.premium().await {
            return None;
        }
        tokio::select! {
            permit = self.background_hq_limiter.clone().acquire_owned() => permit.ok(),
            () = playback_joined.notified() => None,
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

    use super::super::tests::test_state;

    #[tokio::test]
    async fn background_hq_asks_take_turns_and_a_joining_playback_skips_the_queue() {
        let (root, state) = test_state("background-turn");
        let first = state.background_turn(&Notify::new()).await;
        assert!(first.is_some());

        let playback_joined = Notify::new();
        let second = state.background_turn(&playback_joined);
        tokio::pin!(second);
        let waited = tokio::time::timeout(Duration::from_millis(50), &mut second).await;
        assert!(waited.is_err());
        playback_joined.notify_one();
        assert!(second.await.is_none());

        let joined_early = Notify::new();
        joined_early.notify_one();
        assert!(state.background_turn(&joined_early).await.is_none());

        drop(first);
        assert!(state.background_turn(&Notify::new()).await.is_some());
        std::fs::remove_dir_all(root).ok();
    }
}
