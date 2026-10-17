import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  IDLE_AUTH,
  type LastfmAuth,
  type ScrobbleService,
  type ScrobbleStatus,
  useScrobbleStore,
} from '../../stores/scrobble';
import { describeError, logError } from '../diagnostics';

const AUTH_POLL_MS = 3000;
const AUTH_TIMEOUT_MS = 5 * 60_000;
const START_FAILURES = ['network', 'refused'] as const;

let authTimer: ReturnType<typeof setTimeout> | null = null;
let authDeadline = 0;
let authAttempt = 0;

function apply(status: ScrobbleStatus) {
  useScrobbleStore.setState({ status });
}

function setAuth(lastfmAuth: LastfmAuth) {
  useScrobbleStore.setState({ lastfmAuth });
}

function authPending(): boolean {
  const { phase } = useScrobbleStore.getState().lastfmAuth;
  return phase === 'waiting' || phase === 'manual';
}

function isCurrentAttempt(attempt: number): boolean {
  return attempt === authAttempt && authPending();
}

export async function loadScrobbleStatus(): Promise<void> {
  try {
    apply(await invoke<ScrobbleStatus>('scrobble_status'));
  } catch (e) {
    console.warn('[Scrobble] status failed:', e);
  }
}

export async function refreshScrobbleProfiles(): Promise<void> {
  try {
    apply(await invoke<ScrobbleStatus>('scrobble_refresh'));
  } catch (e) {
    console.warn('[Scrobble] refresh failed:', e);
  }
}

export async function disconnectScrobbler(service: ScrobbleService): Promise<void> {
  apply(await invoke<ScrobbleStatus>('scrobble_disconnect', { service }));
}

export async function connectListenbrainz(token: string): Promise<void> {
  apply(await invoke<ScrobbleStatus>('listenbrainz_connect', { token }));
}

function stopAuthPolling() {
  if (authTimer) clearTimeout(authTimer);
  authTimer = null;
}

async function pollLastfmAuth() {
  authTimer = null;
  if (!authPending()) return;
  const attempt = authAttempt;
  try {
    const status = await invoke<ScrobbleStatus | null>('lastfm_auth_finish');
    if (!isCurrentAttempt(attempt)) return;
    if (status) {
      useScrobbleStore.setState({ status, lastfmAuth: IDLE_AUTH });
      return;
    }
  } catch (e) {
    if (!isCurrentAttempt(attempt)) return;
    if (String(e) === 'expired') {
      setAuth({ phase: 'error', failure: 'failed' });
      return;
    }
  }
  if (Date.now() > authDeadline) {
    void cancelLastfmAuth();
    return;
  }
  authTimer = setTimeout(pollLastfmAuth, AUTH_POLL_MS);
}

export async function startLastfmAuth(): Promise<void> {
  if (useScrobbleStore.getState().lastfmAuth.phase === 'connecting') return;
  stopAuthPolling();
  const attempt = ++authAttempt;
  setAuth({ phase: 'connecting' });

  let url: string;
  try {
    url = await invoke<string>('lastfm_auth_start');
  } catch (e) {
    const message = String(e);
    logError(`[Scrobble] Last.fm auth start failed: ${message}`);
    if (attempt === authAttempt) {
      const failure = START_FAILURES.find((reason) => message.startsWith(reason)) ?? 'failed';
      setAuth({ phase: 'error', failure });
    }
    return;
  }
  if (attempt !== authAttempt) return;

  const opened = await openUrl(url).then(
    () => true,
    (e) => {
      logError(`[Scrobble] Last.fm auth page did not open: ${describeError(e)}`);
      return false;
    },
  );
  if (attempt !== authAttempt) return;

  setAuth(opened ? { phase: 'waiting' } : { phase: 'manual', url });
  authDeadline = Date.now() + AUTH_TIMEOUT_MS;
  authTimer = setTimeout(pollLastfmAuth, AUTH_POLL_MS);
}

export async function cancelLastfmAuth(): Promise<void> {
  authAttempt++;
  stopAuthPolling();
  setAuth(IDLE_AUTH);
  await invoke('lastfm_auth_cancel').catch(() => undefined);
}

export function resumeLastfmAuthCheck(): void {
  if (!authPending()) return;
  stopAuthPolling();
  void pollLastfmAuth();
}

void listen('scrobble:changed', () => {
  void loadScrobbleStatus();
});
