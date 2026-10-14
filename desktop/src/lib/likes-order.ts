import {
  type InfiniteData,
  partialMatchKey,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../i18n';
import { useAuthStore } from '../stores/auth';
import type { Track } from '../stores/player';
import { ApiError, api } from './api';
import { fetchLikedTracksSnapshot, invalidateAllLikesCache } from './hooks';
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
const FAILURE_TOAST = 'likes-order-failed';

let queue: Promise<void> = Promise.resolve();
let pending = 0;
let moved = false;
let outOfSync = false;
let stopWatching = () => {};

function requestBody(urn: string, target: LikeTarget) {
  if (target === 'top') return { action: 'move_to_top', track: urn };
  if (target === 'bottom') return { action: 'move_to_bottom', track: urn };
  return { action: 'move_after', track: urn, after: target.after };
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

function holds(data: LikesData, urn: string) {
  return data.pages.some((page) => page.collection.some((track) => track.urn === urn));
}

function placeInPages(data: LikesData, track: Track, target: LikeTarget) {
  const pages = data.pages.map((page) => ({
    ...page,
    collection: page.collection.filter((t) => t.urn !== track.urn),
  }));
  const point = pages.length > 0 ? insertionPoint(pages, target) : null;
  if (point) pages[point[0]].collection.splice(point[1], 0, track);
  return { data: { ...data, pages }, stale: !point && holds(data, track.urn) };
}

function likesInCache(qc: QueryClient) {
  return qc
    .getQueriesData<LikesData>({ queryKey: LIKES_KEY })
    .filter((entry): entry is [QueryKey, LikesData] => !!entry[1]?.pages);
}

function placeInCache(qc: QueryClient, track: Track, target: LikeTarget) {
  let stale = false;
  for (const [key, data] of likesInCache(qc)) {
    const placed = placeInPages(data, track, target);
    qc.setQueryData(key, placed.data);
    stale ||= placed.stale;
  }
  return stale;
}

function restoreInCache(qc: QueryClient, track: Track, place: LikeTarget) {
  for (const [key, data] of likesInCache(qc)) {
    if (holds(data, track.urn)) qc.setQueryData(key, placeInPages(data, track, place).data);
  }
}

function placeOf(qc: QueryClient, urn: string): LikeTarget | null {
  for (const [, data] of likesInCache(qc)) {
    const tracks = data.pages.flatMap((page) => page.collection);
    const at = tracks.findIndex((track) => track.urn === urn);
    if (at === 0) return 'top';
    if (at > 0) return { after: tracks[at - 1].urn };
  }
  return null;
}

function watchFetchedLikes(qc: QueryClient) {
  return qc.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.action.type === 'success' &&
      !event.action.manual &&
      partialMatchKey(event.query.queryKey, LIKES_KEY)
    ) {
      outOfSync = true;
    }
  });
}

function refreshDerivedViews(qc: QueryClient) {
  invalidateAllLikesCache();
  const me = useAuthStore.getState().user?.urn;
  if (me) void qc.invalidateQueries({ queryKey: ['user', me, 'likes', 'tracks'] });
}

function failureText(error: unknown) {
  return error instanceof ApiError && error.code === 'like_not_found'
    ? 'likesOrder.changed'
    : 'likesOrder.failed';
}

async function sendMove(
  qc: QueryClient,
  track: Track,
  target: LikeTarget,
  undo: LikeTarget | null,
) {
  try {
    await api(ORDER_PATH, {
      method: 'POST',
      body: JSON.stringify(requestBody(track.urn, target)),
      quiet: true,
    });
    moved = true;
    void placeLikedUrn(track.urn, target);
  } catch (error) {
    outOfSync = true;
    if (undo) restoreInCache(qc, track, undo);
    toast.error(i18n.t(failureText(error)), { id: FAILURE_TOAST });
  }
}

function settle(qc: QueryClient) {
  pending -= 1;
  if (pending > 0) return;
  stopWatching();
  if (moved) refreshDerivedViews(qc);
  if (outOfSync) void qc.invalidateQueries({ queryKey: LIKES_KEY });
  moved = false;
  outOfSync = false;
}

export function moveLikedTrack(qc: QueryClient, track: Track, target: LikeTarget) {
  if (pending === 0) stopWatching = watchFetchedLikes(qc);
  pending += 1;
  if (qc.isFetching({ queryKey: LIKES_KEY }) > 0) outOfSync = true;
  void qc.cancelQueries({
    queryKey: LIKES_KEY,
    predicate: (query) => query.state.data !== undefined,
  });
  const undo = placeOf(qc, track.urn);
  if (placeInCache(qc, track, target)) outOfSync = true;
  queue = queue.then(() => sendMove(qc, track, target, undo)).finally(() => settle(qc));
}

export function resetLikesOrder(qc: QueryClient): Promise<void> {
  const reset = queue.then(async () => {
    await api(ORDER_PATH, {
      method: 'POST',
      body: JSON.stringify({ action: 'reset' }),
      quiet: true,
    });
    refreshDerivedViews(qc);
    void qc.resetQueries({ queryKey: LIKES_KEY });
    void fetchLikedTracksSnapshot().catch(() => undefined);
  });
  queue = reset.catch(() => undefined);
  return reset;
}
