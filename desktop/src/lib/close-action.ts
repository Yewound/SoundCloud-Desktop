import { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settings';
import { trackedInvoke as invoke } from './diagnostics';

export interface CloseBehavior {
  quitOnClose: boolean;
  trayAvailable: boolean;
}

function pushCloseAction(quitOnClose: boolean) {
  return invoke<CloseBehavior>('close_action_set', { quitOnClose });
}

export function getCloseBehavior() {
  return invoke<CloseBehavior>('close_action_get');
}

export function useTrayAvailable(): boolean {
  const [trayAvailable, setTrayAvailable] = useState(true);

  useEffect(() => {
    getCloseBehavior()
      .then((behavior) => setTrayAvailable(behavior.trayAvailable))
      .catch(() => setTrayAvailable(true));
  }, []);

  return trayAvailable;
}

export function initCloseAction() {
  void pushCloseAction(useSettingsStore.getState().closeAction === 'quit').catch(() => {});
  useSettingsStore.subscribe((state, prev) => {
    if (state.closeAction !== prev.closeAction) {
      void pushCloseAction(state.closeAction === 'quit').catch(() => {});
    }
  });
}
