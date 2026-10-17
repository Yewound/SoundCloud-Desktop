import { edgeFetch } from '../edge';
import { netFetch } from '../net/fetch';
import { mirroredUrl } from '../update-assets';

const RAW_ORIGIN = 'https://raw.githubusercontent.com/';
const MIRROR_TIMEOUT_MS = 20_000;
const DIRECT_TIMEOUT_MS = 10_000;

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length')) > maxBytes) throw new Error('response too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('response too large');
  return bytes;
}

export async function fetchBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const mirrored = url.startsWith(RAW_ORIGIN)
    ? await edgeFetch(mirroredUrl(url), {}, MIRROR_TIMEOUT_MS)
        .then((res) => readCapped(res, maxBytes))
        .catch(() => null)
    : null;
  return mirrored ?? readCapped(await netFetch(url, { timeoutMs: DIRECT_TIMEOUT_MS }), maxBytes);
}
