import {createEffect, createRoot, on} from 'solid-js';
import {useAppSettings} from '@stores/appSettings';
import {SETTINGS_INIT} from '@config/state';

let setupDone = false;

// * Keeps the Electron tray's "notification sound" checkbox in sync with the
// * in-app setting (appSettings.notifications.sound) in both directions:
// *   - tray click -> setAppSettings(...) so the notification manager obeys it
// *   - any in-app change -> push the new state back to the tray menu
export default function setupElectronNotificationSoundSync() {
  if(setupDone || typeof electronHelpers === 'undefined' || !electronHelpers.onSetNotificationSound) {
    return;
  }
  setupDone = true;

  const [appSettings, setAppSettings] = useAppSettings();

  electronHelpers.onSetNotificationSound((enabled) => {
    setAppSettings('notifications', 'sound', enabled);
    if(enabled && !appSettings.notifications.volume) {
      setAppSettings('notifications', 'volume', SETTINGS_INIT.notifications.volume);
    }
  });

  createRoot(() => {
    createEffect(on(() => appSettings.notifications.sound, (sound) => {
      if(typeof sound === 'boolean') {
        electronHelpers?.setNotificationSoundState?.(sound);
      }
    }));
  });
}
