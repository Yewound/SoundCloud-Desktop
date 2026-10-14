import { infiniteQueryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuthStore } from '../stores/auth';
import type { Track } from '../stores/player';
import { api } from './api';
import { getIsPremium, usePremium } from './premium-cache';
import { queryClient } from './query-client';

export const FREE_SUPERLIKES = 10;

export interface SuperlikeQuota {
  used: number;
  limit: number | null;
}

interface SuperlikesPage {
  collection: Track[];
  next_href: string | null;
}

const QUOTA_KEY = ['superlikes', 'quota'] as const;
export const SUPERLIKES_LIST_KEY = ['superlikes', 'list'] as const;
const FIRST_PAGE = '?limit=50';

const _superliked = new Map<string, boolean>();
const _writing = new Set<string>();
const _droppedWithLike = new Set<string>();
const _listeners = new Set<() => void>();

function notify() {
  for (const l of _listeners) l();
}

export function subscribeSuperliked(cb: () => void) {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

export function setSuperlikedUrn(urn: string, superliked: boolean) {
  _droppedWithLike.delete(urn);
  if (_superliked.get(urn) === superliked) return;
  _superliked.set(urn, superliked);
  notify();
}

export function seedSuperliked(urn: string, superliked: boolean | undefined) {
  if (!superliked || _superliked.has(urn)) return;
  _superliked.set(urn, true);
  notify();
}

export function isUrnSuperliked(urn: string): boolean {
  return _superliked.get(urn) === true;
}

export function useSuperliked(urn: string, seed?: boolean): boolean {
  useEffect(() => seedSuperliked(urn, seed), [urn, seed]);
  return useSyncExternalStore(subscribeSuperliked, () => _superliked.get(urn) === true);
}

export function beginSuperlikeWrite(urn: string) {
  _writing.add(urn);
}

export function endSuperlikeWrite(urn: string) {
  _writing.delete(urn);
}

function syncFromServer(collection: Track[], complete: boolean) {
  const listed = new Set(collection.map((track) => track.urn));
  let changed = false;
  const settle = (urn: string, superliked: boolean) => {
    if (_writing.has(urn) || _droppedWithLike.has(urn)) return;
    if (_superliked.get(urn) === superliked) return;
    _superliked.set(urn, superliked);
    changed = true;
  };
  for (const urn of listed) settle(urn, true);
  if (complete) {
    for (const [urn, superliked] of _superliked)
      if (superliked && !listed.has(urn)) settle(urn, false);
  }
  if (changed) notify();
}

export function forgetSuperlike(urn: string) {
  if (!isUrnSuperliked(urn)) return;
  _superliked.set(urn, false);
  _droppedWithLike.add(urn);
  notify();
  shiftQuota(-1);
}

export function recheckSuperlike(urn: string) {
  if (!_droppedWithLike.delete(urn)) return;
  void queryClient.invalidateQueries({ queryKey: ['superlikes'] });
}

function shiftQuota(delta: number) {
  queryClient.setQueriesData<SuperlikeQuota>({ queryKey: QUOTA_KEY }, (quota) =>
    quota ? { ...quota, used: Math.max(0, quota.used + delta) } : quota,
  );
}

export function rememberQuota(quota: SuperlikeQuota) {
  queryClient.setQueriesData<SuperlikeQuota>({ queryKey: QUOTA_KEY }, () => ({
    used: quota.used,
    limit: quota.limit,
  }));
}

export function cachedQuota(): SuperlikeQuota | undefined {
  return queryClient.getQueryData<SuperlikeQuota>([...QUOTA_KEY, getIsPremium()]);
}

export function isQuotaFull(quota: SuperlikeQuota | undefined): boolean {
  return !!quota && quota.limit != null && quota.used >= quota.limit;
}

export function useSuperlikeQuota() {
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const premium = usePremium();
  return useQuery({
    queryKey: [...QUOTA_KEY, premium],
    queryFn: () => api<SuperlikeQuota>('/superlikes/quota'),
    enabled: authenticated,
    staleTime: 60_000,
  });
}

export function useSuperlikeCount(): number {
  return useSuperlikeQuota().data?.used ?? 0;
}

const superlikesList = infiniteQueryOptions({
  queryKey: SUPERLIKES_LIST_KEY,
  queryFn: async ({ pageParam }) => {
    const page = await api<SuperlikesPage>(`/superlikes${pageParam}`);
    syncFromServer(page.collection, pageParam === FIRST_PAGE && !page.next_href);
    return page;
  },
  initialPageParam: FIRST_PAGE,
  getNextPageParam: (last) => last.next_href ?? undefined,
});

export function useSuperlikesWarm() {
  const used = useSuperlikeCount();
  useInfiniteQuery({ ...superlikesList, enabled: used > 0, staleTime: 60_000 });
}

export function useSuperlikedTracks() {
  const query = useInfiniteQuery({
    ...superlikesList,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const tracks = useMemo(
    () => query.data?.pages.flatMap((page) => page.collection) ?? [],
    [query.data],
  );
  return { ...query, tracks };
}
