import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type ThemeNotice, useThemesStore } from '../../stores/themes';
import { onIdle } from '../idle';
import { syncThemeCss } from './apply';
import { missingFiles, repair } from './files';
import { activeLook } from './records';

const STARTUP_IDLE_MS = 20_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const CHECK_JITTER_MS = 30 * 60 * 1000;

const TOAST_KEYS: Record<ThemeNotice['kind'], string> = {
  updated: 'settings.themesUpdatedToast',
  revoked: 'settings.themesRevokedToast',
  downloadFailed: 'settings.themesDownloadFailedToast',
  checkFailed: 'settings.themesCheckFailedToast',
  breaksUi: 'settings.themesBreaksUiToast',
  crashOff: 'settings.themesCrashOffToast',
};

let bootVerified = false;

export function useThemes() {
  const { t } = useTranslation();
  const look = useThemesStore(activeLook);
  const notices = useThemesStore((s) => s.notices);

  useEffect(() => {
    void syncThemeCss(look);
  }, [look]);

  useEffect(() => {
    if (!notices.length) return;
    const { rollback, setEnabled } = useThemesStore.getState();
    for (const notice of notices) {
      const action =
        notice.kind === 'updated'
          ? { label: t('settings.themesRollback'), onClick: () => rollback(notice.id) }
          : notice.kind === 'crashOff'
            ? { label: t('settings.themesEnable'), onClick: () => void setEnabled(true) }
            : undefined;
      toast(t(TOAST_KEYS[notice.kind], { name: notice.name }), {
        id: `theme:${notice.kind}:${notice.id}`,
        action,
        duration: action ? 10_000 : undefined,
      });
    }
    useThemesStore.setState({ notices: [] });
  }, [notices, t]);

  useEffect(() => {
    if (bootVerified) return;
    bootVerified = true;
    void useThemesStore.getState().verifyActive();
  }, []);

  useEffect(() => {
    const check = () => {
      const { installed, refresh } = useThemesStore.getState();
      if (Object.keys(installed).length) void refresh(false);
    };
    const stopIdle = onIdle(STARTUP_IDLE_MS, async () => {
      stopIdle();
      check();
      for (const [id, theme] of Object.entries(useThemesStore.getState().installed)) {
        for (const version of theme.previous ? [theme, theme.previous] : [theme]) {
          if (await missingFiles(version)) await repair(id, version).catch(() => undefined);
        }
      }
      await syncThemeCss(activeLook(useThemesStore.getState()));
    });
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          check();
          schedule();
        },
        CHECK_EVERY_MS + Math.random() * CHECK_JITTER_MS,
      );
    };
    schedule();
    const onOnline = () => {
      if (Date.now() - useThemesStore.getState().checkedAt > CHECK_EVERY_MS) check();
    };
    window.addEventListener('online', onOnline);
    return () => {
      stopIdle();
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
