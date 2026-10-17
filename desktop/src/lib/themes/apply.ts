import { getStaticPort } from '../constants';
import { inspectThemeCss, rewriteThemeAssetUrls } from './css-guard.ts';
import { type InstalledVersion, readThemeCss } from './files';

const CUSTOM_STYLE_ID = 'sc-custom-css';

let themeStyle: HTMLStyleElement | null = null;
let applySeq = 0;

export function themeSheet(): CSSStyleSheet | null {
  return themeStyle?.sheet ?? null;
}

export function applyThemeCss(css: string) {
  if (!css) {
    themeStyle?.remove();
    return;
  }
  themeStyle ??= Object.assign(document.createElement('style'), { id: 'sc-theme-css' });
  if (themeStyle.textContent !== css) themeStyle.textContent = css;
  const custom = document.getElementById(CUSTOM_STYLE_ID);
  if (custom && themeStyle.nextElementSibling !== custom) {
    document.head.insertBefore(themeStyle, custom);
  } else if (!custom && document.head.lastElementChild !== themeStyle) {
    document.head.appendChild(themeStyle);
  }
}

export async function syncThemeCss(look: InstalledVersion | null): Promise<boolean> {
  const seq = ++applySeq;
  const port = getStaticPort();
  const source = look ? await readThemeCss(look.files.css).catch(() => null) : null;
  let css: string | null = null;
  if (look && port && source !== null) {
    const assets = look.files.assets;
    if (!inspectThemeCss(source, Object.keys(assets)).errors.length) {
      css = rewriteThemeAssetUrls(
        source,
        (name) => `http://127.0.0.1:${port}/theme-files/${assets[name]}`,
      );
    }
  }
  if (seq === applySeq) applyThemeCss(css ?? '');
  return css !== null;
}
