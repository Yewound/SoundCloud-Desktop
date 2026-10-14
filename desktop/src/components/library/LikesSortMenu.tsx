import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RotateCcw } from '../../lib/icons';
import { resetLikesOrder } from '../../lib/likes-order';
import { useAppMode } from '../../stores/app-status';
import { useSettingsStore } from '../../stores/settings';
import { TrackSortMenu } from '../music/TrackSortMenu';
import { Modal, ModalClose, ModalContent, ModalDescription, ModalTitle } from '../ui/Modal';

export const LikesSortMenu = React.memo(function LikesSortMenu({ loading }: { loading: boolean }) {
  const sort = useSettingsStore((s) => s.likesSort);
  const setSort = useSettingsStore((s) => s.setLikesSort);
  const online = useAppMode() === 'online';
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <TrackSortMenu
        sort={sort}
        context="likes"
        loading={loading}
        onSort={setSort}
        onReset={online ? () => setConfirming(true) : undefined}
      />
      <ResetOrderDialog open={confirming} onOpenChange={setConfirming} />
    </>
  );
});

function ResetOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const confirm = () => {
    setPending(true);
    resetLikesOrder(qc)
      .then(() => {
        useSettingsStore.getState().setLikesSort('default');
        onOpenChange(false);
        toast.success(t('likesOrder.resetDone'));
      })
      .catch(() => toast.error(t('likesOrder.resetFailed')))
      .finally(() => setPending(false));
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="sm" showClose={false}>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0">
              <RotateCcw size={18} className="text-white/60" />
            </div>
            <ModalTitle>{t('likesOrder.resetTitle')}</ModalTitle>
          </div>
          <ModalDescription className="text-[13px] text-white/50 leading-relaxed">
            {t('likesOrder.resetText')}
          </ModalDescription>
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <ModalClose className="px-4 py-2 rounded-xl text-[13px] font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-all cursor-pointer">
              {t('common.cancel')}
            </ModalClose>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-accent/15 text-accent hover:bg-accent/25 border border-accent/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {pending ? t('common.loading') : t('likesOrder.resetAction')}
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
