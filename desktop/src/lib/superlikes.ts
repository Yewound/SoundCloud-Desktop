import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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

const _superliked = new Map<string, boolean>();
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

export function forgetSuperlike(urn: string) {
  if (!isUrnSuperliked(urn)) return;
  setSuperlikedUrn(urn, false);
  void queryClient.invalidateQueries({ queryKey: ['superlikes'] });
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

export function useSuperlikedTracks() {
  const query = useInfiniteQuery({
    queryKey: SUPERLIKES_LIST_KEY,
    queryFn: async ({ pageParam }) => {
      const page = await api<SuperlikesPage>(`/superlikes${pageParam}`);
      for (const track of page.collection) seedSuperliked(track.urn, true);
      return page;
    },
    initialPageParam: '?limit=50',
    getNextPageParam: (last) => last.next_href ?? undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const tracks = useMemo(
    () => query.data?.pages.flatMap((page) => page.collection) ?? [],
    [query.data],
  );
  return { ...query, tracks };
}
