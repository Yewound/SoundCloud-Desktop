import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { art } from '../../../lib/formatters';
import { Music, Repeat2 } from '../../../lib/icons';
import { FREE_SUPERLIKES, useSuperlikedTracks } from '../../../lib/superlikes';
import type { Track } from '../../../stores/player';

export const SlotPicker = memo(function SlotPicker({ onPick }: { onPick: (track: Track) => void }) {
  const { t } = useTranslation();
  const { tracks } = useSuperlikedTracks();
  const slots = tracks.slice(0, FREE_SUPERLIKES);
  if (slots.length === 0) return null;

  return (
    <div className="mt-5">
      <p className="mb-2.5 text-[12px] font-medium text-white/45">{t('superlike.freeSlot')}</p>
      <div className="grid grid-cols-5 gap-2">
        {slots.map((track) => (
          <SlotCover key={track.urn} track={track} onPick={onPick} />
        ))}
      </div>
    </div>
  );
});

function SlotCover({ track, onPick }: { track: Track; onPick: (track: Track) => void }) {
  const { t } = useTranslation();
  const cover = art(track.artwork_url, 't200x200');
  const label = t('superlike.moveFrom', { title: track.title });
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onPick(track)}
      className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-white/[0.08] transition-all duration-200 hover:ring-superlike-via/70 hover:scale-[1.04] cursor-pointer"
    >
      {cover ? (
        <img src={cover} alt="" className="h-full w-full object-cover" decoding="async" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/25">
          <Music size={16} />
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <Repeat2 size={18} />
      </span>
    </button>
  );
}
