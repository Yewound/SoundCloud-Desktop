import { getStaticPort } from '../constants';
import { inspectThemeCss, rewriteThemeAssetUrls } from './css-guard.ts';
import { type InstalledVersion, readThemeCss } from './files';

export const THEME_STYLE_ID = 'sc-theme-css';
const CUSTOM_STYLE_ID = 'sc-custom-css';

let applySeq = 0;

export function applyThemeCss(css: string, doc: Document = document) {
  const existing = doc.getElementById(THEME_STYLE_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing ?? Object.assign(doc.createElement('style'), { id: THEME_STYLE_ID });
  if (style.textContent !== css) style.textContent = css;
  const custom = doc.getElementById(CUSTOM_STYLE_ID);
  if (custom && style.nextElementSibling !== custom) doc.head.insertBefore(style, custom);
  else if (!custom && doc.head.lastElementChild !== style) doc.head.appendChild(style);
}

export function composeThemeCss(css: string, assets: Record<string, string>): string | null {
  const port = getStaticPort();
  if (!port || inspectThemeCss(css, Object.keys(assets)).errors.length) return null;
  return rewriteThemeAssetUrls(
    css,
    (name) => `http://127.0.0.1:${port}/theme-files/${assets[name]}`,
  );
}

export async function loadThemeCss(look: InstalledVersion): Promise<string | null> {
  const css = await readThemeCss(look.files.css).catch(() => null);
  return css === null ? null : composeThemeCss(css, look.files.assets);
}

export async function syncThemeCss(look: InstalledVersion | null): Promise<boolean> {
  const seq = ++applySeq;
  const css = look ? await loadThemeCss(look) : null;
  if (seq === applySeq) applyThemeCss(css ?? '');
  return css !== null;
}
