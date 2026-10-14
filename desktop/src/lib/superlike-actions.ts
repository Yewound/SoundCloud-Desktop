import type { Track } from '../stores/player';
import { type SuperlikeTarget, useSuperlikeLimit } from '../stores/superlike-limit';
import { ApiError, api } from './api';
import { clearDislike } from './dislike-actions';
import { invalidateAllLikesCache } from './hooks';
import { applyLikeLocally, isUrnLiked, setLikedUrn } from './likes';
import { rememberLikedUrn } from './offline-index';
import { queryClient } from './query-client';
import {
  beginSuperlikeWrite,
  cachedQuota,
  endSuperlikeWrite,
  isQuotaFull,
  isUrnSuperliked,
  rememberQuota,
  SUPERLIKES_LIST_KEY,
  type SuperlikeQuota,
  setSuperlikedUrn,
} from './superlikes';

export type { SuperlikeTarget };

interface SuperlikeAnswer extends SuperlikeQuota {
  superliked: boolean;
}

const LIMIT_REACHED = 'superlike_limit_reached';

function isFullTrack(target: SuperlikeTarget): target is Track {
  return typeof target.title === 'string' && !!target.user;
}

function markLiked(target: SuperlikeTarget, liked: boolean) {
  if (isFullTrack(target)) applyLikeLocally(queryClient, target, liked);
  else setLikedUrn(target.urn, liked);
  invalidateAllLikesCache();
}

function superlikePath(urn: string) {
  return `/superlikes/${encodeURIComponent(urn)}`;
}

async function superlike(target: SuperlikeTarget): Promise<boolean> {
  const wasLiked = isUrnLiked(target.urn) || !!target.user_favorite;
  beginSuperlikeWrite(target.urn);
  setSuperlikedUrn(target.urn, true);
  if (!wasLiked) {
    markLiked(target, true);
    clearDislike(target.urn);
  }
  try {
    const answer = await api<SuperlikeAnswer>(superlikePath(target.urn), {
      method: 'POST',
      silentStatuses: [402],
    });
    rememberQuota(answer);
    if (!wasLiked) void rememberLikedUrn(target.urn, isFullTrack(target) ? target : undefined);
    void queryClient.invalidateQueries({ queryKey: SUPERLIKES_LIST_KEY });
    return true;
  } catch (error) {
    setSuperlikedUrn(target.urn, false);
    if (!wasLiked) markLiked(target, false);
    if (error instanceof ApiError && error.code === LIMIT_REACHED) {
      void queryClient.invalidateQueries({ queryKey: ['superlikes'] });
      useSuperlikeLimit.getState().open(target);
    }
    return false;
  } finally {
    endSuperlikeWrite(target.urn);
  }
}

export async function removeSuperlike(target: SuperlikeTarget): Promise<boolean> {
  beginSuperlikeWrite(target.urn);
  setSuperlikedUrn(target.urn, false);
  try {
    rememberQuota(await api<SuperlikeAnswer>(superlikePath(target.urn), { method: 'DELETE' }));
    void queryClient.invalidateQueries({ queryKey: SUPERLIKES_LIST_KEY });
    return true;
  } catch {
    setSuperlikedUrn(target.urn, true);
    return false;
  } finally {
    endSuperlikeWrite(target.urn);
  }
}

export function requestSuperlike(target: SuperlikeTarget): boolean {
  if (isQuotaFull(cachedQuota())) {
    useSuperlikeLimit.getState().open(target);
    return false;
  }
  void superlike(target);
  return true;
}

export function toggleSuperlike(target: SuperlikeTarget): boolean {
  if (isUrnSuperliked(target.urn)) {
    void removeSuperlike(target);
    return false;
  }
  return requestSuperlike(target);
}

export async function moveSuperlike(from: SuperlikeTarget, to: SuperlikeTarget): Promise<boolean> {
  if (!(await removeSuperlike(from))) return false;
  return superlike(to);
}
