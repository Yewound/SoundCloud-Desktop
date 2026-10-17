import { useAuthStore } from '../stores/auth';
import { api } from './api';
import { isLocalUrn } from './local-library';
import { noteWaveOutcome } from './wave-feedback';

export type SoundWaveEvent =
  | 'like'
  | 'local_like'
  | 'playlist_add'
  | 'full_play'
  | 'skip'
  | 'dislike';

const LANDING_WAIT_MS = 2000;
const inFlight = new Set<Promise<unknown>>();

/**
 * Fire-and-forget event recorder for SoundWave taste model.
 * `positionPct` (0..1) only meaningful for `skip` and `full_play` — backend uses
 * it to split skips into early/mid/late buckets with different negative weight.
 */
export function recordEvent(
  eventType: SoundWaveEvent,
  scTrackId: string,
  positionPct?: number,
): void {
  if (!scTrackId || isLocalUrn(scTrackId)) return;
  const scUserId = useAuthStore.getState().user?.urn;
  if (!scUserId) return;

  const body: Record<string, unknown> = { scUserId, scTrackId, eventType };
  const position =
    positionPct != null && Number.isFinite(positionPct)
      ? Math.max(0, Math.min(1, positionPct))
      : undefined;
  if (position !== undefined) body.positionPct = position;
  noteWaveOutcome(eventType, scTrackId, position);

  const request = api('/events', {
    method: 'POST',
    body: JSON.stringify(body),
  }).catch(() => {});
  inFlight.add(request);
  void request.finally(() => inFlight.delete(request));
}

export async function eventsLanded(): Promise<void> {
  if (inFlight.size === 0) return;
  await Promise.race([
    Promise.all(inFlight),
    new Promise((resolve) => setTimeout(resolve, LANDING_WAIT_MS)),
  ]);
}
