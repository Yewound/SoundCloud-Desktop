import { useTranslation } from 'react-i18next';
import { type SyncStatus, useSyncStatus } from '../../lib/sync-status';
import { Row } from '../settings/primitives';
import { SyncStatusBadge } from './SyncStatusChip';
import { useSyncCopy } from './useSyncCopy';

function SyncRow({ status }: { status: SyncStatus }) {
  const { t } = useTranslation();
  const { hint, action } = useSyncCopy(status);
  return (
    <div className="mb-4 border-b border-white/[0.05] pb-4">
      <Row title={t('sync.title')} desc={hint}>
        <SyncStatusBadge status={status} withAction={false} />
        {action && (
          <button
            type="button"
            onClick={action.run}
            disabled={action.disabled}
            className="cursor-pointer rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11.5px] font-semibold text-white/75 transition-colors hover:border-white/[0.16] hover:bg-white/[0.09] hover:text-white/95 disabled:cursor-default disabled:opacity-40"
          >
            {action.label}
          </button>
        )}
      </Row>
    </div>
  );
}

export function SyncStatusRow() {
  const { data } = useSyncStatus();
  if (!data) return null;
  return <SyncRow status={data} />;
}
