import { getStaticPort } from './constants';
import { resolveCssAssets } from './css-assets';
import { isMac } from './platform';
import { stripRemoteCss } from './themes/css-guard.ts';

const STYLE_ID = 'sc-custom-css';

export const sanitizeCustomCss = stripRemoteCss;

let cached: { source: string; enabled: boolean; port: number | null; css: string } | null = null;

export function effectiveCustomCss(state: { customCss: string; customCssEnabled: boolean }) {
  const port = getStaticPort();
  if (
    cached?.source === state.customCss &&
    cached.enabled === state.customCssEnabled &&
    cached.port === port
  ) {
    return cached.css;
  }
  const css = state.customCssEnabled ? resolveCssAssets(stripRemoteCss(state.customCss).css) : '';
  cached = { source: state.customCss, enabled: state.customCssEnabled, port, css };
  return css;
}

export function applyCustomCss(css: string, doc: Document = document) {
  const existing = doc.getElementById(STYLE_ID);
  if (!css.trim()) {
    existing?.remove();
    return;
  }
  const style = existing ?? Object.assign(doc.createElement('style'), { id: STYLE_ID });
  if (style.textContent !== css) style.textContent = css;
  if (doc.head.lastElementChild !== style) doc.head.appendChild(style);
}

export function isCustomCssHotkey(e: KeyboardEvent): boolean {
  if (e.code !== 'KeyC' || !e.shiftKey || !e.altKey || e.getModifierState('AltGraph')) return false;
  return isMac() ? e.metaKey : e.ctrlKey;
}

export function customCssHotkeyLabel(): string[] {
  return isMac() ? ['⌘', '⌥', '⇧', 'C'] : ['Ctrl', 'Alt', 'Shift', 'C'];
}
