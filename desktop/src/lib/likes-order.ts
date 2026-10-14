import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../i18n';
import { useAuthStore } from '../stores/auth';
import type { Track } from '../stores/player';
import { ApiError, api } from './api';
import { invalidateAllLikesCache } from './hooks';
import { placeLikedUrn } from './offline-index';

export type LikeTarget = 'top' | 'bottom' | { after: string };

export const LIKED_ORDER_SCOPE = 'liked-order';

interface LikesPage {
  collection: Track[];
  has_more: boolean;
}

type LikesData = InfiniteData<LikesPage, unknown>;

const LIKES_KEY: QueryKey = ['me', 'likes', 'tracks'];
const ORDER_PATH = '/me/likes/tracks/order';

let queue: Promise<void> = Promise.resolve();
let generation = 0;

function requestBody(urn: string, target: LikeTarget) {
  if (target === 'bottom') return { action: 'move_to_bottom', track: urn };
  return { action: 'move', track: urn, after: target === 'top' ? null : target.after };
}

function insertionPoint(pages: LikesPage[], target: LikeTarget): [number, number] | null {
  if (target === 'top') return [0, 0];
  const last = pages.length - 1;
  if (target === 'bottom') {
    return pages[last].has_more ? null : [last, pages[last].collection.length];
  }
  for (let page = 0; page < pages.length; page++) {
    const at = pages[page].collection.findIndex((track) => track.urn === target.after);
    if (at >= 0) return [page, at + 1];
  }
  return null;
}

function placeInPages(data: LikesData, track: Track, target: LikeTarget) {
  const loaded = data.pages.some((page) => page.collection.some((t) => t.urn === track.urn));
  const pages = data.pages.map((page) => ({
    ...page,
    collection: page.collection.filter((t) => t.urn !== track.urn),
  }));
  const point = pages.length > 0 ? insertionPoint(pages, target) : null;
  if (point) pages[point[0]].collection.splice(point[1], 0, track);
  return { data: { ...data, pages }, stale: loaded && !point };
}

function placeInCache(qc: QueryClient, track: Track, target: LikeTarget): QueryKey[] {
  const stale: QueryKey[] = [];
  for (const [key, data] of qc.getQueriesData<LikesData>({ queryKey: LIKES_KEY })) {
    if (!data?.pages) continue;
    const placed = placeInPages(data, track, target);
    qc.setQueryData(key, placed.data);
    if (placed.stale) stale.push(key);
  }
  return stale;
}

function refreshDerivedViews(qc: QueryClient) {
  invalidateAllLikesCache();
  const me = useAuthStore.getState().user?.urn;
  if (me) void qc.invalidateQueries({ queryKey: ['user', me, 'likes', 'tracks'] });
}

function failureText(error: unknown) {
  return error instanceof ApiError && error.status === 404
    ? 'likesOrder.gone'
    : 'likesOrder.failed';
}

export function moveLikedTrack(qc: QueryClient, track: Track, target: LikeTarget) {
  const before = qc.getQueriesData<LikesData>({ queryKey: LIKES_KEY });
  const stale = placeInCache(qc, track, target);
  const ticket = generation;
  queue = queue.then(async () => {
    if (ticket !== generation) return;
    try {
      await api(ORDER_PATH, {
        method: 'POST',
        body: JSON.stringify(requestBody(track.urn, target)),
        quiet: true,
      });
      refreshDerivedViews(qc);
      for (const key of stale) void qc.invalidateQueries({ queryKey: key, exact: true });
      void placeLikedUrn(track.urn, target);
    } catch (error) {
      generation += 1;
      for (const [key, data] of before) qc.setQueryData(key, data);
      toast.error(i18n.t(failureText(error)));
    }
  });
}

export function resetLikesOrder(qc: QueryClient): Promise<void> {
  const reset = queue.then(async () => {
    await api(ORDER_PATH, {
      method: 'POST',
      body: JSON.stringify({ action: 'reset' }),
      quiet: true,
    });
    refreshDerivedViews(qc);
    await qc.invalidateQueries({ queryKey: LIKES_KEY });
  });
  queue = reset.catch(() => undefined);
  return reset;
}
