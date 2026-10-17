import i18n from '../i18n';
import { trackedInvoke as invoke } from './diagnostics';

function pushLabels() {
  void invoke('tray_set_labels', {
    labels: {
      show: i18n.t('trayMenu.show'),
      mini: i18n.t('trayMenu.mini'),
      playPause: i18n.t('trayMenu.playPause'),
      prev: i18n.t('trayMenu.prev'),
      next: i18n.t('trayMenu.next'),
      quit: i18n.t('trayMenu.quit'),
    },
  }).catch(() => {});
}

export function initTrayMenu() {
  pushLabels();
  i18n.on('languageChanged', pushLabels);
}
