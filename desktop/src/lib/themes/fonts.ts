import type { BUNDLED_FONTS } from '../interface-font';
import type { ThemeFont } from './rules.ts';

type BundledFont = keyof typeof BUNDLED_FONTS;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const THEME_FONTS_ARE_BUNDLED: Same<ThemeFont, BundledFont> = true;

export function themeFont(font: ThemeFont): BundledFont {
  return font;
}
