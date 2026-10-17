import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { originalOf } from '../../lib/alt-upload';
import { Replace } from '../../lib/icons';

export const AltUploadMark = React.memo(function AltUploadMark({ urn }: { urn: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const original = originalOf(urn);
  if (!original) return null;
  return (
    <button
      type="button"
      title={t('player.altUpload')}
      aria-label={t('player.altUpload')}
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/track/${encodeURIComponent(original.urn)}`);
      }}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 transition-colors duration-200 hover:bg-white/[0.08]"
      style={{ color: 'var(--color-accent)' }}
    >
      <Replace size={11} />
    </button>
  );
});
