import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSuperlikeCount, useSuperlikedTracks } from '../../../lib/superlikes';
import { TrackCard } from '../../music/TrackCard';
import { SuperHeart } from '../../music/superlike/SuperHeart';
import { CollectionRail } from '../CollectionRail';

export const SuperlikesRail = memo(function SuperlikesRail({ genre }: { genre: string | null }) {
  const count = useSuperlikeCount();
  if (count === 0) return null;
  return <SuperlikesRailBody genre={genre} count={count} />;
});

function SuperlikesRailBody({ genre, count }: { genre: string | null; count: number }) {
  const { t } = useTranslation();
  const { tracks } = useSuperlikedTracks();
  const preview = useMemo(() => {
    const base = genre ? tracks.filter((tr) => tr.genre?.trim() === genre) : tracks;
    return base.slice(0, 12);
  }, [tracks, genre]);
  if (preview.length === 0) return null;

  return (
    <CollectionRail
      icon={<SuperHeart size={16} />}
      title={t('superlikes.title')}
      count={count}
      to="/library/superlikes"
    >
      {preview.map((tr) => (
        <div key={tr.urn} className="w-[150px] shrink-0">
          <TrackCard track={tr} queue={preview} />
        </div>
      ))}
    </CollectionRail>
  );
}
