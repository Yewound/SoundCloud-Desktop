export const THEME_LIMITS = {
  cssBytes: 262_144,
  dataUriChars: 65_536,
  assetBytes: 1_048_576,
  assetsTotalBytes: 3_145_728,
  assetsCount: 24,
  previewBytes: 262_144,
  previewMinWidth: 960,
  previewMaxWidth: 1600,
  previewMinAspect: 1.4,
  previewMaxAspect: 1.8,
  indexBytes: 2_097_152,
} as const;

export const TEXT_LIMITS = { name: 32, description: 140, authorName: 40 } as const;

export const THEME_ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
export const THEME_RESERVED_IDS = ['tools'] as const;
export const THEME_ASSET_NAME =
  /^[a-z0-9][a-z0-9_-]{0,47}\.(webp|png|jpg|jpeg|avif|gif|svg|woff2)$/;
export const THEME_PREVIEW_PATHS = ['preview.webp', 'preview.png'] as const;
export const SHA256 = /^[0-9a-f]{64}$/;
export const GIT_REV = /^[0-9a-f]{40}$/;
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const HEX_COLOR = /^#[0-9a-f]{6}$/;
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export const THEME_FONTS = [
  'inter',
  'manrope',
  'onest',
  'golos',
  'montserrat',
  'rubik',
  'nunito',
  'raleway',
  'comfortaa',
  'system',
] as const;
export const THEME_LICENSES = [
  'MIT',
  'Apache-2.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
] as const;
export const THEME_LANGS = ['en', 'ru', 'tr', 'ko'] as const;

export type ThemeFont = (typeof THEME_FONTS)[number];
export type AssetType = 'webp' | 'png' | 'jpeg' | 'avif' | 'gif' | 'svg' | 'woff2';

const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const SVG_START = /^\uFEFF?[ \t\r\n]*(?:<\?xml|<svg|<!--)/;

export function isThemePath(path: string): boolean {
  if (path === 'theme.css') return true;
  if ((THEME_PREVIEW_PATHS as readonly string[]).includes(path)) return true;
  return path.startsWith('assets/') && THEME_ASSET_NAME.test(path.slice(7));
}

export function isCleanText(text: string, max: number): boolean {
  if (text.length < 1 || text.length > max) return false;
  return text === text.trim() && !UNSAFE_TEXT.test(text);
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < 3; i++) {
    const x = left[i] ?? '';
    const y = right[i] ?? '';
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function startsWith(bytes: Uint8Array, offset: number, signature: string): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature.charCodeAt(i)) return false;
  }
  return true;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    text = decoder.decode(bytes.subarray(0, 1024), { stream: true });
  } catch {
    return false;
  }
  return SVG_START.test(text) && text.includes('<svg');
}

export function sniffAssetType(bytes: Uint8Array): AssetType | null {
  if (startsWith(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (startsWith(bytes, 0, '\xff\xd8\xff')) return 'jpeg';
  if (startsWith(bytes, 0, 'GIF87a') || startsWith(bytes, 0, 'GIF89a')) return 'gif';
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'webp';
  if (
    startsWith(bytes, 4, 'ftyp') &&
    (startsWith(bytes, 8, 'avif') || startsWith(bytes, 8, 'avis'))
  ) {
    return 'avif';
  }
  if (startsWith(bytes, 0, 'wOF2')) return 'woff2';
  if (looksLikeSvg(bytes)) return 'svg';
  return null;
}
