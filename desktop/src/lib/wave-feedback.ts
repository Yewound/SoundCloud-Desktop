import { api } from './api';
import type { SoundWaveEvent } from './events';

export const LATE_SKIP_SHARE = 0.7;

let wave: Set<string> | null = null;
let negatives = 0;
let positives = 0;

export function followWave(owned: Set<string>): void {
  wave = owned;
  negatives = 0;
  positives = 0;
}

export function leaveWave(owned: Set<string>): void {
  if (wave === owned) wave = null;
}

export function noteWaveOutcome(
  outcome: SoundWaveEvent | 'superlike',
  urn: string,
  positionPct?: number,
): void {
  if (!wave?.has(urn)) return;
  if (outcome === 'dislike' || (outcome === 'skip' && (positionPct ?? 0) < LATE_SKIP_SHARE)) {
    negatives += 1;
  } else if (outcome === 'full_play' || outcome === 'like' || outcome === 'superlike') {
    positives += 1;
  }
}

export async function sendWaveFeedback(cursor: string): Promise<string | null> {
  if (!cursor || (negatives === 0 && positives === 0)) return null;
  const body = JSON.stringify({ cursor, negatives, positives });
  negatives = 0;
  positives = 0;
  try {
    const res = await api<{ ok: boolean; cursor?: string | null }>(
      '/recommendations/wave/feedback',
      { method: 'POST', body },
    );
    return res?.cursor ?? null;
  } catch {
    return null;
  }
}
