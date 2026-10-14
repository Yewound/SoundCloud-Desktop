import type { PlaybackQuality } from '../stores/player';

export const QUALITY_RANK: Record<PlaybackQuality, number> = { sq: 0, hq: 1, uq: 2 };

export function isBelow(quality: PlaybackQuality | null, wanted: PlaybackQuality): boolean {
  return QUALITY_RANK[quality ?? 'sq'] < QUALITY_RANK[wanted];
}

export const QUALITY_LABEL_KEYS: Record<PlaybackQuality, string> = {
  uq: 'player.qualityUQ',
  hq: 'player.qualityHQ',
  sq: 'player.qualitySQ',
};
