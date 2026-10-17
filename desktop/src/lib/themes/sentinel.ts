import { BaseDirectory, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';

const SENTINEL_PATH = 'themes/applying';
const APP_DATA = { baseDir: BaseDirectory.AppData };

let written: string | null = null;

export async function writeSentinel(id: string, hash: string): Promise<void> {
  await mkdir('themes', { ...APP_DATA, recursive: true }).catch(() => undefined);
  await writeTextFile(SENTINEL_PATH, `${id} ${hash}`, APP_DATA).catch(() => undefined);
  written = `${id} ${hash}`;
}

export async function readSentinel(): Promise<{ id: string; hash: string } | null> {
  const text = await readTextFile(SENTINEL_PATH, APP_DATA).catch(() => '');
  const [id, hash] = text.trim().split(' ');
  return id && hash ? { id, hash } : null;
}

export async function clearSentinel(): Promise<void> {
  written = null;
  await remove(SENTINEL_PATH, APP_DATA).catch(() => undefined);
}

export function sentinelHolds(id: string, hash: string): boolean {
  return written === `${id} ${hash}`;
}
