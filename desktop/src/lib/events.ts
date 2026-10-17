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
const inFlight = new Set<Promise<void>>();

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

  trackTasteWrite(
    api('/events', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ).catch(() => {});
}

export function trackTasteWrite<T>(request: Promise<T>): Promise<T> {
  const landed = request.then(
    () => {},
    () => {},
  );
  inFlight.add(landed);
  void landed.then(() => inFlight.delete(landed));
  return request;
}

export async function tasteWritesLanded(): Promise<void> {
  if (inFlight.size === 0) return;
  await Promise.race([
    Promise.all(inFlight),
    new Promise((resolve) => setTimeout(resolve, LANDING_WAIT_MS)),
  ]);
}
