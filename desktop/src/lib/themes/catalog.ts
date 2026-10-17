import { BaseDirectory, mkdir, readTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { APP_VERSION, THEMES_RAW_BASE } from '../constants';
import { fetchBytes } from './fetch';
import { type Catalog, indexUrl, parseIndex } from './index-parse.ts';
import { THEME_LIMITS } from './rules.ts';

const INDEX_PATH = 'themes/index.json';
const APP_DATA = { baseDir: BaseDirectory.AppData };

export async function loadCatalog(): Promise<Catalog> {
  const bytes = await fetchBytes(indexUrl(THEMES_RAW_BASE), THEME_LIMITS.indexBytes);
  const catalog = parseIndex(JSON.parse(new TextDecoder().decode(bytes)), APP_VERSION);
  if (!catalog) throw new Error('themes index rejected');
  await mkdir('themes', { ...APP_DATA, recursive: true }).catch(() => undefined);
  await writeFile(INDEX_PATH, bytes, APP_DATA).catch(() => undefined);
  return catalog;
}

export async function readCachedCatalog(): Promise<Catalog | null> {
  try {
    return parseIndex(JSON.parse(await readTextFile(INDEX_PATH, APP_DATA)), APP_VERSION);
  } catch {
    return null;
  }
}
