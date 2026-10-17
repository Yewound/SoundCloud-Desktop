import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSettingsStore } from '../stores/settings';
import { applyCustomCss, effectiveCustomCss, isCustomCssHotkey } from './custom-css';
import { safeModeOff, safeModeToggle } from './safe-mode';

export function useCustomCss() {
  const { t } = useTranslation();
  const customCss = useSettingsStore((s) => s.customCss);
  const customCssEnabled = useSettingsStore((s) => s.customCssEnabled);
  const css = useMemo(
    () => effectiveCustomCss({ customCss, customCssEnabled }),
    [customCss, customCssEnabled],
  );

  useEffect(() => {
    applyCustomCss(css);
  }, [css]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isCustomCssHotkey(e) || e.repeat) return;
      const result = safeModeToggle();
      if (!result) return;
      e.preventDefault();
      toast(t(result === 'off' ? 'settings.customCssOffToast' : 'settings.customCssOnToast'));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [t]);

  useEffect(() => {
    const unlisten = listen('safe-mode', () => {
      safeModeOff('relaunch');
      toast(t('settings.safeModeRelaunchToast'));
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [t]);
}
