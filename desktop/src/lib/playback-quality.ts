import type { PlaybackQuality } from '../stores/player';

export const QUALITY_LABEL_KEYS: Record<PlaybackQuality, string> = {
  uq: 'player.qualityUQ',
  hq: 'player.qualityHQ',
  sq: 'player.qualitySQ',
};
