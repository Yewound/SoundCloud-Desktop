import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer } from 'react';
import { useAuthStore } from '../stores/auth';
import { ApiError, api } from './api';
import { onApiWrite } from './api-writes';
import { queryClient } from './query-client';

export interface PlaylistCreate {
  targetUrn: string;
  title: string;
  state: 'queued' | 'delayed' | 'failed';
}

export interface SyncStatus {
  pendingCount: number;
  failedCount: number;
  delayedCount: number;
  retryInSec: number | null;
  deadCount: number;
  needsRelogin: boolean;
  playlistCreates: PlaylistCreate[] | null;
  playlistCreatesTruncated: boolean;
}

export type SyncState = 'synced' | 'syncing' | 'delayed' | 'failed' | 'dead' | 'relogin';

const SYNC_KEY = ['me', 'sync'] as const;
const POLL_MS = 30_000;
export const SYNC_STATUS_CACHE_MS = 6_000;
const RETRY_COOLDOWN_MS = 2 * 60_000;
const SYNCED_WRITE = /^\/(likes|me\/followings|playlists|tracks|reposts)\//;

let retriedAt = 0;

onApiWrite((path) => {
  if (!SYNCED_WRITE.test(path)) return;
  setTimeout(() => queryClient.invalidateQueries({ queryKey: SYNC_KEY }), SYNC_STATUS_CACHE_MS);
});

export async function fetchSyncStatus(): Promise<SyncStatus | null> {
  let raw: Partial<SyncStatus>;
  try {
    raw = await api<Partial<SyncStatus>>('/me/sync', { silentStatuses: [404], quiet: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  const status: SyncStatus = {
    pendingCount: raw.pendingCount ?? 0,
    failedCount: raw.failedCount ?? 0,
    delayedCount: raw.delayedCount ?? 0,
    retryInSec: raw.retryInSec ?? null,
    deadCount: raw.deadCount ?? 0,
    needsRelogin: raw.needsRelogin ?? false,
    playlistCreates: raw.playlistCreates ?? null,
    playlistCreatesTruncated: raw.playlistCreatesTruncated ?? false,
  };

  const before = queryClient.getQueryData<SyncStatus | null>(SYNC_KEY)?.playlistCreates;
  if (before && status.playlistCreates && !status.playlistCreatesTruncated) {
    const still = new Set(status.playlistCreates.map((create) => create.targetUrn));
    if (before.some((create) => !still.has(create.targetUrn))) {
      void queryClient.invalidateQueries({ queryKey: ['me', 'playlists'] });
    }
  }
  return status;
}

export function useSyncRetry() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const until = retriedAt + RETRY_COOLDOWN_MS;

  useEffect(() => {
    const left = until - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(rerender, left);
    return () => clearTimeout(timer);
  }, [until]);

  const retry = useCallback(async (targetUrn?: string) => {
    try {
      await api('/me/sync/retry', {
        method: 'POST',
        body: JSON.stringify(targetUrn ? { targetUrn } : {}),
      });
    } catch {
      return;
    }
    retriedAt = Date.now();
    rerender();
    await queryClient.invalidateQueries({ queryKey: SYNC_KEY });
  }, []);

  return { retry, cooling: until > Date.now() };
}

export function syncStateOf(status: SyncStatus): SyncState {
  if (status.needsRelogin) return 'relogin';
  if (status.deadCount > 0) return 'dead';
  if (status.delayedCount > 0) return 'delayed';
  if (status.failedCount - status.deadCount > 0) return 'failed';
  if (status.pendingCount > 0) return 'syncing';
  return 'synced';
}

export function useSyncStatus(opts?: { enabled?: boolean }) {
  const hasSession = useAuthStore((s) => s.hasSession);
  return useQuery<SyncStatus | null>({
    queryKey: SYNC_KEY,
    queryFn: fetchSyncStatus,
    staleTime: POLL_MS / 2,
    refetchInterval: POLL_MS,
    retry: false,
    enabled: hasSession && (opts?.enabled ?? true),
  });
}
