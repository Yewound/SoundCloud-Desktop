import { SUPERLIKES_LIST_KEY, type SuperlikesPage } from './superlikes';
import { listOrder } from './list-order';

export const SUPERLIKED_ORDER_SCOPE = 'superliked-order';

export const superlikesOrder = listOrder<SuperlikesPage>({
  key: SUPERLIKES_LIST_KEY,
  path: '/superlikes/order',
  hasMore: (page) => page.next_href != null,
  missingCode: 'superlike_not_found',
  changedText: 'superlikes.orderChanged',
  failureToast: 'superlikes-order-failed',
});
