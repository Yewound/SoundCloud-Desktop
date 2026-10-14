import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setTrackLiked } from '../../lib/like-toggle';
import { setLikedUrn, useLiked } from '../../lib/likes';
import { useSuperliked } from '../../lib/superlikes';
import type { Track } from '../../stores/player';
import { HoldHeart } from './superlike/HoldHeart';
import { useSuperlikeGesture } from './superlike/useSuperlikeGesture';

export const LikeButton = React.memo(function LikeButton({
  track,
  variant = 'inline',
  position = 'top-2 left-2',
}: {
  track: Track;
  variant?: 'overlay' | 'inline';
  position?: string;
}) {
  const { t } = useTranslation();
  const liked = useLiked(track.urn);
  const superliked = useSuperliked(track.urn, track.user_superlike) && liked;
  const label = superliked
    ? t('superlike.superliked')
    : liked
      ? t('track.unlike')
      : t('track.like');
  const title = `${label} · ${t('superlike.holdHint')}`;

  // Seed from API data when available
  useEffect(() => {
    if (track.user_favorite) setLikedUrn(track.urn, true);
  }, [track.urn, track.user_favorite]);
  const qc = useQueryClient();

  const gesture = useSuperlikeGesture(track, (e) => {
    e.stopPropagation();
    void setTrackLiked(qc, track, !liked);
  });
  const heart = <HoldHeart liked={liked} superliked={superliked} size={14} gesture={gesture} />;

  if (variant === 'overlay') {
    return (
      <button
        type="button"
        {...gesture.handlers}
        aria-label={label}
        aria-pressed={liked}
        title={title}
        className={`cursor-pointer absolute ${position} w-8 h-8 rounded-full backdrop-blur-md flex items-center justify-center group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-200 ${
          superliked || gesture.holding ? 'opacity-100' : 'opacity-0'
        } ${
          superliked
            ? 'bg-black/60'
            : liked
              ? 'bg-accent/80 text-accent-contrast'
              : 'bg-black/50 text-white/80 hover:text-white hover:bg-black/70'
        }`}
      >
        {heart}
      </button>
    );
  }

  return (
    <button
      type="button"
      {...gesture.handlers}
      aria-label={label}
      aria-pressed={liked}
      title={title}
      className={`cursor-pointer w-8 h-8 rounded-lg flex items-center justify-center group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-200 shrink-0 ${
        superliked || gesture.holding ? 'opacity-100' : 'opacity-0'
      } ${liked ? 'text-accent' : 'text-white/20 hover:text-white/50'}`}
    >
      {heart}
    </button>
  );
});
