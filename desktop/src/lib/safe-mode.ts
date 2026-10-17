import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { logInfo } from './diagnostics';
import { activeLook } from './themes/records';

type SafeModeSource = 'hotkey' | 'flag' | 'relaunch';

let lastOff: { custom: boolean; theme: boolean } | null = null;

function customCssOn(): boolean {
  const { customCss, customCssEnabled } = useSettingsStore.getState();
  return customCssEnabled && customCss.trim() !== '';
}

export function safeModeOff(source: SafeModeSource) {
  const themes = useThemesStore.getState();
  const custom = customCssOn();
  const theme = activeLook(themes) !== null;
  themes.revertTrial();
  useSettingsStore.getState().setCustomCssEnabled(false);
  void themes.setEnabled(false);
  if (custom || theme) lastOff = { custom, theme };
  logInfo(`[SafeMode] off by ${source}: custom css ${custom}, theme ${theme}`);
}

export function safeModeToggle(): 'off' | 'on' | null {
  if (customCssOn() || activeLook(useThemesStore.getState()) !== null) {
    safeModeOff('hotkey');
    return 'off';
  }
  const { customCss, setCustomCssEnabled } = useSettingsStore.getState();
  const { activeId, installed, setEnabled } = useThemesStore.getState();
  const restore = lastOff ?? {
    custom: customCss.trim() !== '',
    theme: activeId !== null && activeId in installed,
  };
  lastOff = null;
  if (!restore.custom && !restore.theme) return null;
  if (restore.custom) setCustomCssEnabled(true);
  if (restore.theme) void setEnabled(true);
  return 'on';
}
