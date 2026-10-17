import { useEffect, useRef } from 'react';
import { fetchSmartWave, type SmartWaveSeedKind } from '../../../lib/soundwave';
import { followWave, leaveWave, sendWaveFeedback } from '../../../lib/wave-feedback';
import type { Track } from '../../../stores/player';
import { usePlayerStore } from '../../../stores/player';

export function useInfiniteWave(opts: {
  enabled: boolean;
  seedKind: SmartWaveSeedKind;
  seedId?: string;
  initialTracks: Track[];
  initialCursor: string | null;
  languages?: string[];
  filterTrack?: (t: Track) => boolean;
  hideListened?: boolean;
  minTail?: number;
  batchLimit?: number;
}) {
  const {
    enabled,
    seedKind,
    seedId,
    initialTracks,
    initialCursor,
    languages,
    filterTrack,
    hideListened,
    minTail = 5,
    batchLimit = 20,
  } = opts;

  const ownedRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef<string>(initialCursor ?? '');
  const fetchingRef = useRef(false);
  const languagesRef = useRef(languages);
  const filterRef = useRef(filterTrack);
  const hideListenedRef = useRef(hideListened);

  useEffect(() => {
    languagesRef.current = languages;
  }, [languages]);
  useEffect(() => {
    filterRef.current = filterTrack;
  }, [filterTrack]);
  useEffect(() => {
    hideListenedRef.current = hideListened;
  }, [hideListened]);

  useEffect(() => {
    if (initialCursor) cursorRef.current = initialCursor;
  }, [initialCursor]);

  useEffect(() => {
    for (const t of initialTracks) ownedRef.current.add(t.urn);
  }, [initialTracks]);

  useEffect(() => {
    if (!enabled || seedKind !== 'user') return;
    const owned = ownedRef.current;
    followWave(owned);
    return () => leaveWave(owned);
  }, [enabled, seedKind]);

  useEffect(() => {
    if (!enabled) return;

    return usePlayerStore.subscribe((state, prev) => {
      const { queue, queueIndex, currentTrack, isPlaying } = state;
      // Narrowed: only react to refill-relevant fields.
      if (
        queueIndex === prev.queueIndex &&
        queue.length === prev.queue.length &&
        currentTrack?.urn === prev.currentTrack?.urn &&
        isPlaying === prev.isPlaying
      ) {
        return;
      }
      if (!currentTrack) return;
      if (!ownedRef.current.has(currentTrack.urn)) return;

      const remaining = queue.length - queueIndex - 1;
      if (remaining > minTail) return;
      if (!isPlaying && remaining > 0) return;
      if (fetchingRef.current) return;

      fetchingRef.current = true;
      (async () => {
        try {
          if (seedKind === 'user') {
            const updated = await sendWaveFeedback(cursorRef.current);
            if (updated) cursorRef.current = updated;
          }
          const batch = await fetchSmartWave({
            seedKind,
            seedId,
            cursor: cursorRef.current || undefined,
            limit: batchLimit,
            languages: languagesRef.current,
            hideListened: hideListenedRef.current,
          });
          if (batch.cursor) cursorRef.current = batch.cursor;
          const filterFn = filterRef.current;
          const existing = new Set(usePlayerStore.getState().queue.map((t) => t.urn));
          const fresh = batch.tracks.filter(
            (t) => !existing.has(t.urn) && (!filterFn || filterFn(t)),
          );
          if (fresh.length > 0) {
            usePlayerStore.getState().addToQueue(fresh);
            for (const t of fresh) ownedRef.current.add(t.urn);
          }
        } catch (e) {
          console.debug('[soundwave] infinite refill failed:', e);
        } finally {
          fetchingRef.current = false;
        }
      })();
    });
  }, [enabled, seedKind, seedId, minTail, batchLimit]);
}
