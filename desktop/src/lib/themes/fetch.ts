import { edgeFetch } from '../edge';
import { netFetch } from '../net/fetch';
import { mirroredUrl } from '../update-assets';

const RAW_ORIGIN = 'https://raw.githubusercontent.com/';
const MIRROR_TIMEOUT_MS = 20_000;
const DIRECT_TIMEOUT_MS = 10_000;

async function readChecked(res: Response, maxBytes: number, sha256?: string): Promise<Uint8Array> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length')) > maxBytes) throw new Error('response too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('response too large');
  if (sha256) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== sha256) throw new Error('hash mismatch');
  }
  return bytes;
}

export async function fetchBytes(
  url: string,
  maxBytes: number,
  sha256?: string,
): Promise<Uint8Array> {
  const mirrored = url.startsWith(RAW_ORIGIN)
    ? await edgeFetch(mirroredUrl(url), {}, MIRROR_TIMEOUT_MS)
        .then((res) => readChecked(res, maxBytes, sha256))
        .catch(() => null)
    : null;
  if (mirrored) return mirrored;
  const res = await netFetch(url, { timeoutMs: DIRECT_TIMEOUT_MS });
  return readChecked(res, maxBytes, sha256);
}
