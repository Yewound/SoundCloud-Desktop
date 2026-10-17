import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { askRelogin } from '../../lib/auth-recovery';
import { type SyncState, type SyncStatus, syncStateOf, useSyncRetry } from '../../lib/sync-status';

const HOUR_THRESHOLD_SEC = 90 * 60;

export interface SyncAction {
  label: string;
  run: () => void;
  disabled: boolean;
}

export interface SyncCopy {
  state: SyncState;
  label: string;
  hint: string;
  action?: SyncAction;
}

export function syncTimeText(t: TFunction, sec: number | null): string {
  if (sec == null || sec < 60) return t('sync.retrySoon');
  if (sec < HOUR_THRESHOLD_SEC) return t('sync.retryMinutes', { count: Math.ceil(sec / 60) });
  return t('sync.retryHours', { count: Math.round(sec / 3600) });
}

export function useSyncCopy(status: SyncStatus): SyncCopy {
  const { t } = useTranslation();
  const { retry, cooling } = useSyncRetry();
  const state = syncStateOf(status);
  const time = syncTimeText(t, status.retryInSec);

  switch (state) {
    case 'relogin':
      return {
        state,
        label: t('sync.chip.relogin'),
        hint: t('sync.hint.relogin'),
        action: { label: t('sync.signIn'), run: () => askRelogin(), disabled: false },
      };
    case 'dead':
      return {
        state,
        label: t('sync.chip.dead', { count: status.deadCount }),
        hint: t('sync.hint.dead'),
        action: { label: t('common.retry'), run: () => retry(), disabled: cooling },
      };
    case 'delayed':
      return {
        state,
        label: t('sync.chip.delayed', { time }),
        hint: t('sync.hint.delayed', { count: status.delayedCount, time }),
      };
    case 'failed':
      return {
        state,
        label: t('sync.chip.failed', { count: status.failedCount - status.deadCount }),
        hint: t('sync.hint.failed'),
      };
    case 'syncing':
      return {
        state,
        label: t('sync.chip.syncing', { count: status.pendingCount }),
        hint: t('sync.hint.syncing'),
      };
    default:
      return { state, label: t('sync.chip.synced'), hint: t('sync.hint.synced') };
  }
}
