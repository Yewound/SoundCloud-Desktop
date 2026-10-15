import {
  type InfiniteData,
  partialMatchKey,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../i18n';
import type { Track } from '../stores/player';
import { ApiError, api } from './api';

export type OrderTarget = 'top' | 'bottom' | { after: string };

interface OrderPage {
  collection: Track[];
}

type Pages<P extends OrderPage> = InfiniteData<P, unknown>;

export interface OrderedList<P extends OrderPage> {
  key: QueryKey;
  path: string;
  hasMore: (page: P) => boolean;
  missingCode: string;
  changedText: string;
  failureToast: string;
  onMoved?: (urn: string, target: OrderTarget) => void;
  onChanged?: (qc: QueryClient) => void;
}

export interface ListOrder {
  move: (qc: QueryClient, track: Track, target: OrderTarget) => void;
  reset: (qc: QueryClient) => Promise<void>;
}

function requestBody(urn: string, target: OrderTarget) {
  if (target === 'top') return { action: 'move_to_top', track: urn };
  if (target === 'bottom') return { action: 'move_to_bottom', track: urn };
  return { action: 'move_after', track: urn, after: target.after };
}

function holds<P extends OrderPage>(data: Pages<P>, urn: string) {
  return data.pages.some((page) => page.collection.some((track) => track.urn === urn));
}

export function listOrder<P extends OrderPage>(list: OrderedList<P>): ListOrder {
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  let moved = false;
  let outOfSync = false;
  let stopWatching = () => {};

  function insertionPoint(pages: P[], target: OrderTarget): [number, number] | null {
    if (target === 'top') return [0, 0];
    const last = pages.length - 1;
    if (target === 'bottom') {
      return list.hasMore(pages[last]) ? null : [last, pages[last].collection.length];
    }
    for (let page = 0; page < pages.length; page++) {
      const at = pages[page].collection.findIndex((track) => track.urn === target.after);
      if (at >= 0) return [page, at + 1];
    }
    return null;
  }

  function placeInPages(data: Pages<P>, track: Track, target: OrderTarget) {
    const pages = data.pages.map((page) => ({
      ...page,
      collection: page.collection.filter((t) => t.urn !== track.urn),
    }));
    const point = pages.length > 0 ? insertionPoint(pages, target) : null;
    if (point) pages[point[0]].collection.splice(point[1], 0, track);
    return { data: { ...data, pages }, stale: !point && holds(data, track.urn) };
  }

  function cached(qc: QueryClient) {
    return qc
      .getQueriesData<Pages<P>>({ queryKey: list.key })
      .filter((entry): entry is [QueryKey, Pages<P>] => !!entry[1]?.pages);
  }

  function placeInCache(qc: QueryClient, track: Track, target: OrderTarget) {
    let stale = false;
    for (const [key, data] of cached(qc)) {
      const placed = placeInPages(data, track, target);
      qc.setQueryData(key, placed.data);
      stale ||= placed.stale;
    }
    return stale;
  }

  function restoreInCache(qc: QueryClient, track: Track, place: OrderTarget) {
    for (const [key, data] of cached(qc)) {
      if (holds(data, track.urn)) qc.setQueryData(key, placeInPages(data, track, place).data);
    }
  }

  function placeOf(qc: QueryClient, urn: string): OrderTarget | null {
    for (const [, data] of cached(qc)) {
      const tracks = data.pages.flatMap((page) => page.collection);
      const at = tracks.findIndex((track) => track.urn === urn);
      if (at === 0) return 'top';
      if (at > 0) return { after: tracks[at - 1].urn };
    }
    return null;
  }

  function watchFetches(qc: QueryClient) {
    return qc.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        !event.action.manual &&
        partialMatchKey(event.query.queryKey, list.key)
      ) {
        outOfSync = true;
      }
    });
  }

  function failureText(error: unknown) {
    return error instanceof ApiError && error.code === list.missingCode
      ? list.changedText
      : 'likesOrder.failed';
  }

  async function sendMove(
    qc: QueryClient,
    track: Track,
    target: OrderTarget,
    undo: OrderTarget | null,
  ) {
    try {
      await api(list.path, {
        method: 'POST',
        body: JSON.stringify(requestBody(track.urn, target)),
        quiet: true,
      });
      moved = true;
      list.onMoved?.(track.urn, target);
    } catch (error) {
      outOfSync = true;
      if (undo) restoreInCache(qc, track, undo);
      toast.error(i18n.t(failureText(error)), { id: list.failureToast });
    }
  }

  function settle(qc: QueryClient) {
    pending -= 1;
    if (pending > 0) return;
    stopWatching();
    if (moved) list.onChanged?.(qc);
    if (outOfSync) void qc.invalidateQueries({ queryKey: list.key });
    moved = false;
    outOfSync = false;
  }

  function move(qc: QueryClient, track: Track, target: OrderTarget) {
    if (pending === 0) stopWatching = watchFetches(qc);
    pending += 1;
    if (qc.isFetching({ queryKey: list.key }) > 0) outOfSync = true;
    void qc.cancelQueries({
      queryKey: list.key,
      predicate: (query) => query.state.data !== undefined,
    });
    const undo = placeOf(qc, track.urn);
    if (placeInCache(qc, track, target)) outOfSync = true;
    queue = queue.then(() => sendMove(qc, track, target, undo)).finally(() => settle(qc));
  }

  function reset(qc: QueryClient): Promise<void> {
    const done = queue.then(async () => {
      await api(list.path, {
        method: 'POST',
        body: JSON.stringify({ action: 'reset' }),
        quiet: true,
      });
      list.onChanged?.(qc);
      void qc.resetQueries({ queryKey: list.key });
    });
    queue = done.catch(() => undefined);
    return done;
  }

  return { move, reset };
}
