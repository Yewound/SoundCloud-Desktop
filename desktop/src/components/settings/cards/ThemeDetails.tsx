import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../lib/formatters';
import { ArrowUp, Check, Pin, RotateCcw, Trash2 } from '../../../lib/icons';
import { BUNDLED_FONTS } from '../../../lib/interface-font';
import { pickDescription } from '../../../lib/themes/index-parse.ts';
import { activeTheme, hasUpdate, isRevoked } from '../../../lib/themes/records';
import { useThemesStore } from '../../../stores/themes';
import { Modal, ModalContent, ModalDescription, ModalTitle } from '../../ui/Modal';
import { Toggle } from '../primitives';
import { itemBroken, type ThemeItem, ThemeSwatch, themePreviewUrl } from './ThemeTile';

function ActionButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3.5 py-2 text-[12.5px] font-medium transition-all cursor-pointer hover:bg-white/[0.08] ${
        danger ? 'text-red-300/80 hover:text-red-200' : 'text-white/65 hover:text-white/90'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="h-4 w-4 rounded-full border border-white/15"
      style={{ background: color }}
      title={color}
    />
  );
}

export function ThemeDetails({ item, onClose }: { item: ThemeItem | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const active = useThemesStore((s) => (item ? activeTheme(s) === s.installed[item.id] : false));
  const busy = useThemesStore((s) => s.busy !== null);
  const catalog = useThemesStore((s) => s.catalog);
  const { startTrial, update, rollback, setPinned, remove } = useThemesStore.getState();
  const entry = item?.entry ?? null;
  const installed = item?.installed ?? null;
  const name = entry?.name ?? installed?.name ?? '';
  const accent = entry?.accent ?? installed?.accent;
  const background = entry?.background ?? installed?.background;
  const font = entry?.font ?? installed?.font;
  const preview = entry ? themePreviewUrl(entry) : null;
  const broken = item ? itemBroken(item) : false;
  const canApply = !busy && !broken && (entry ? entry.compatible : !!installed);
  const canUpdate = !!installed && !!entry && hasUpdate(installed, entry) && !broken;
  const previous = installed?.previous;
  const canRollback = !!item && !!previous && !isRevoked(catalog, item.id, previous.hash);

  const apply = () => {
    if (!item) return;
    onClose();
    void startTrial(item.id);
  };

  return (
    <Modal open={!!item} onOpenChange={(open) => !open && onClose()}>
      <ModalContent size="lg">
        <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-white/[0.03]">
          {preview ? (
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <ThemeSwatch accent={accent ?? '#ffffff'} background={background ?? '#0b0b0e'} />
          )}
        </div>
        <div className="space-y-4 overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <ModalTitle>{name}</ModalTitle>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/40">
                <span>v{entry?.version ?? installed?.version}</span>
                {entry && <span>{entry.author.name}</span>}
                {entry && <span>{formatBytes(entry.size)}</span>}
                {accent && <Swatch color={accent} />}
                {background && <Swatch color={background} />}
                {font && (
                  <span
                    style={{ fontFamily: BUNDLED_FONTS[font].family }}
                    className="text-white/60"
                  >
                    Aa
                  </span>
                )}
              </div>
            </div>
            {active ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--color-accent)] px-4 py-2 text-[12.5px] font-semibold text-white">
                <Check size={14} strokeWidth={3} />
                {t('settings.themesActive')}
              </span>
            ) : (
              <button
                type="button"
                disabled={!canApply}
                onClick={apply}
                className="shrink-0 rounded-xl bg-[var(--color-accent)] px-5 py-2 text-[13px] font-semibold text-[var(--color-accent-contrast)] transition-all cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                style={canApply ? { boxShadow: '0 0 20px var(--color-accent-glow)' } : undefined}
              >
                {t('settings.themesApply')}
              </button>
            )}
          </div>
          {entry && (
            <ModalDescription className="selectable text-[13px] leading-relaxed text-white/60">
              {pickDescription(entry.description, i18n.language)}
            </ModalDescription>
          )}
          {entry && !entry.compatible && (
            <p className="text-[12px] text-amber-300/70">
              {t('settings.themesNeedsApp', { version: entry.minApp })}
            </p>
          )}
          {broken && <p className="text-[12px] text-red-300/80">{t('settings.themesBroken')}</p>}
          {installed && item && (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
              {canUpdate && (
                <ActionButton
                  icon={<ArrowUp size={14} />}
                  label={t('settings.themesUpdate')}
                  onClick={() => void update(item.id)}
                />
              )}
              {canRollback && (
                <ActionButton
                  icon={<RotateCcw size={14} />}
                  label={t('settings.themesRollback')}
                  onClick={() => rollback(item.id)}
                />
              )}
              <ActionButton
                icon={<Trash2 size={14} />}
                label={t('settings.themesRemove')}
                danger
                onClick={() => {
                  onClose();
                  remove(item.id);
                }}
              />
              <label className="ml-auto inline-flex items-center gap-2.5 text-[12.5px] text-white/60">
                <Pin size={14} />
                {t('settings.themesPin')}
                <Toggle
                  checked={installed.pinned}
                  onChange={() => setPinned(item.id, !installed.pinned)}
                  label={t('settings.themesPin')}
                />
              </label>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
