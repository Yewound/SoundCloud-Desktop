import React from 'react';
import {useTranslation} from 'react-i18next';
import {useDiscoverFeed} from '../../../lib/hooks';
import {armLikesContinuation, armSuperlikesContinuation} from '../../../lib/queue-continuation';
import {useSuperlikeCount, useSuperlikedTracks} from '../../../lib/superlikes';
import type {Track} from '../../../stores/player';
import {SubShelf} from './SubShelf';

export type ArchiveShelf = 'superlikes' | 'likes' | 'recommended';

interface ArchiveProps {
  shelves: ArchiveShelf[];
  titled: boolean;
  likedTracks: Track[];
  likedLoading: boolean;
}

interface ShelfTracks {
  tracks: Track[];
  isLoading: boolean;
}

const NO_TRACKS: ShelfTracks = { tracks: [], isLoading: false };

const SHELVES: Record<ArchiveShelf, { label: string; onPlay?: () => void; to?: string }> = {
  superlikes: {
    label: 'superlikes.title',
    onPlay: armSuperlikesContinuation,
    to: '/library/superlikes',
  },
  likes: { label: 'library.likedTracks', onPlay: armLikesContinuation },
  recommended: { label: 'home.recommended' },
};

function useSuperlikesShelf(shelves: ArchiveShelf[]): ShelfTracks {
  const count = useSuperlikeCount();
  const shown = shelves.includes('superlikes') && count > 0;
  const { tracks, isLoading } = useSuperlikedTracks(shown);
  return shown ? { tracks, isLoading } : NO_TRACKS;
}

function ArchiveView({
  shelves,
  titled,
  likedTracks,
  likedLoading,
  superliked,
  recommended,
}: ArchiveProps & { superliked: ShelfTracks; recommended: ShelfTracks }) {
  const { t } = useTranslation();
  const lists: Record<ArchiveShelf, ShelfTracks> = {
    superlikes: superliked,
    likes: { tracks: likedTracks, isLoading: likedLoading },
    recommended,
  };
  const filled = shelves.some((shelf) => lists[shelf].isLoading || lists[shelf].tracks.length > 0);
  if (!filled) return null;

  return (
    <section className="pt-14">
      {titled && (
        <div className="mb-5">
          <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-white/92">
            {t('soundwave.river.archiveTitle')}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-white/50">
            {t('soundwave.river.archiveWhy')}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-8">
        {shelves.map((shelf, i) => (
          <SubShelf
            key={shelf}
            index={String(i + 1).padStart(2, '0')}
            label={t(SHELVES[shelf].label)}
            isLoading={lists[shelf].isLoading}
            tracks={lists[shelf].tracks}
            onPlay={SHELVES[shelf].onPlay}
            to={SHELVES[shelf].to}
          />
        ))}
      </div>
    </section>
  );
}

function RecommendedArchive(props: ArchiveProps & { superliked: ShelfTracks }) {
  const discover = useDiscoverFeed();
  return (
    <ArchiveView
      {...props}
      recommended={{ tracks: discover.recommended, isLoading: discover.isLoading }}
    />
  );
}

export const ArchiveStation = React.memo(function ArchiveStation(props: ArchiveProps) {
  const superliked = useSuperlikesShelf(props.shelves);
  return props.shelves.includes('recommended') ? (
    <RecommendedArchive {...props} superliked={superliked} />
  ) : (
    <ArchiveView {...props} superliked={superliked} recommended={NO_TRACKS} />
  );
});
