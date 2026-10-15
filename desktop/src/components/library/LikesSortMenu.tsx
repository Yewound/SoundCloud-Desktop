import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { resetLikesOrder } from '../../lib/likes-order';
import { useAppMode } from '../../stores/app-status';
import { useSettingsStore } from '../../stores/settings';
import { TrackSortMenu } from '../music/TrackSortMenu';
import { ResetOrderDialog } from './ResetOrderDialog';

export const LikesSortMenu = React.memo(function LikesSortMenu({ loading }: { loading: boolean }) {
  const qc = useQueryClient();
  const sort = useSettingsStore((s) => s.likesSort);
  const setSort = useSettingsStore((s) => s.setLikesSort);
  const online = useAppMode() === 'online';
  const [confirming, setConfirming] = useState(false);

  const reset = async () => {
    await resetLikesOrder(qc);
    setSort('default');
  };

  return (
    <>
      <TrackSortMenu
        sort={sort}
        context="likes"
        loading={loading}
        onSort={setSort}
        onReset={online ? () => setConfirming(true) : undefined}
      />
      <ResetOrderDialog
        open={confirming}
        onOpenChange={setConfirming}
        text="likesOrder.resetText"
        onReset={reset}
      />
    </>
  );
});
