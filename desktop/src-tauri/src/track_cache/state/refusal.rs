use std::time::{Duration, Instant};

use super::{PlaybackQuality, TrackCacheState};

const REFUSAL_TTL: Duration = Duration::from_secs(600);

pub(super) struct Refusal {
    session: Option<String>,
    tier: PlaybackQuality,
    until: Instant,
}

impl Refusal {
    fn holds(&self, session_id: Option<&str>) -> bool {
        self.session.as_deref() == session_id && Instant::now() < self.until
    }
}

fn below(tier: PlaybackQuality) -> PlaybackQuality {
    match tier {
        PlaybackQuality::Uq => PlaybackQuality::Hq,
        _ => PlaybackQuality::Sq,
    }
}

fn capped(
    wanted: PlaybackQuality,
    refusal: Option<&Refusal>,
    session_id: Option<&str>,
) -> PlaybackQuality {
    match refusal {
        Some(r) if r.holds(session_id) && wanted.rank() >= r.tier.rank() => below(r.tier),
        _ => wanted,
    }
}

impl TrackCacheState {
    pub(super) fn allowed_quality(
        &self,
        wanted: PlaybackQuality,
        session_id: Option<&str>,
    ) -> PlaybackQuality {
        self.refusal.lock().map_or(wanted, |refusal| {
            capped(wanted, refusal.as_ref(), session_id)
        })
    }

    pub(super) fn note_refused(&self, tier: PlaybackQuality, session_id: Option<&str>) {
        if tier.rank() == PlaybackQuality::Sq.rank() {
            return;
        }
        let Ok(mut refusal) = self.refusal.lock() else {
            return;
        };
        if refusal
            .as_ref()
            .is_some_and(|r| r.holds(session_id) && r.tier.rank() <= tier.rank())
        {
            return;
        }
        *refusal = Some(Refusal {
            session: session_id.map(str::to_string),
            tier,
            until: Instant::now() + REFUSAL_TTL,
        });
        drop(refusal);
        self.diag(
            "WARN",
            format!(
                "[TrackCache] server refused {} for this session, asking at most {} for {} min",
                tier.label(),
                below(tier).label(),
                REFUSAL_TTL.as_secs() / 60
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::test_state;
    use super::*;
    use PlaybackQuality::{Hq, Sq, Uq};

    fn refused(tier: PlaybackQuality, session: &str, ttl: Duration) -> Refusal {
        Refusal {
            session: Some(session.to_string()),
            tier,
            until: Instant::now() + ttl,
        }
    }

    #[test]
    fn a_refused_tier_drops_the_ask_one_step_below_it() {
        let hq = refused(Hq, "s1", REFUSAL_TTL);
        assert_eq!(capped(Hq, Some(&hq), Some("s1")).label(), "sq");
        assert_eq!(capped(Uq, Some(&hq), Some("s1")).label(), "sq");
        assert_eq!(capped(Sq, Some(&hq), Some("s1")).label(), "sq");

        let uq = refused(Uq, "s1", REFUSAL_TTL);
        assert_eq!(capped(Uq, Some(&uq), Some("s1")).label(), "hq");
        assert_eq!(capped(Hq, Some(&uq), Some("s1")).label(), "hq");
    }

    #[test]
    fn a_refusal_ends_with_its_session_or_its_time() {
        let hq = refused(Hq, "s1", REFUSAL_TTL);
        assert_eq!(capped(Hq, Some(&hq), Some("s2")).label(), "hq");
        assert_eq!(capped(Hq, Some(&hq), None).label(), "hq");
        assert_eq!(capped(Hq, None, Some("s1")).label(), "hq");

        let gone = refused(Hq, "s1", Duration::ZERO);
        assert_eq!(capped(Hq, Some(&gone), Some("s1")).label(), "hq");
    }

    #[test]
    fn the_lowest_refusal_wins_and_sq_is_never_refused() {
        let (root, state) = test_state("refusal");
        state.note_refused(Sq, Some("s1"));
        assert_eq!(state.allowed_quality(Hq, Some("s1")).label(), "hq");

        state.note_refused(Hq, Some("s1"));
        state.note_refused(Uq, Some("s1"));
        assert_eq!(state.allowed_quality(Uq, Some("s1")).label(), "sq");
        assert_eq!(state.allowed_quality(Hq, Some("s2")).label(), "hq");
        std::fs::remove_dir_all(root).ok();
    }
}
