import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import type { Track } from '../stores/player';
import { fetchLikedTracksSnapshot, invalidateAllLikesCache } from './hooks';
import { listOrder } from './list-order';
import { placeLikedUrn } from './offline-index';

export const LIKED_ORDER_SCOPE = 'liked-order';

interface LikesPage {
  collection: Track[];
  has_more: boolean;
}

function refreshDerivedViews(qc: QueryClient) {
  invalidateAllLikesCache();
  const me = useAuthStore.getState().user?.urn;
  if (me) void qc.invalidateQueries({ queryKey: ['user', me, 'likes', 'tracks'] });
}

export const likesOrder = listOrder<LikesPage>({
  key: ['me', 'likes', 'tracks'],
  path: '/me/likes/tracks/order',
  hasMore: (page) => page.has_more,
  missingCode: 'like_not_found',
  changedText: 'likesOrder.changed',
  failureToast: 'likes-order-failed',
  onMoved: (urn, target) => void placeLikedUrn(urn, target),
  onChanged: refreshDerivedViews,
});

export async function resetLikesOrder(qc: QueryClient): Promise<void> {
  await likesOrder.reset(qc);
  void fetchLikedTracksSnapshot().catch(() => undefined);
}
