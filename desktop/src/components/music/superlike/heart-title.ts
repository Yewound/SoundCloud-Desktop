import type { TFunction } from 'i18next';

export function heartLabel(t: TFunction, liked: boolean, superliked: boolean): string {
  if (superliked) return t('superlike.superliked');
  return liked ? t('track.unlike') : t('track.like');
}

export function heartTitle(t: TFunction, liked: boolean, superliked: boolean): string {
  const hint = superliked ? t('superlike.holdToRemove') : t('superlike.holdHint');
  return `${heartLabel(t, liked, superliked)} · ${hint}`;
}
