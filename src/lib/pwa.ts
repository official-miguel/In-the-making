import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** Chrome/Edge/Android event that lets us show our own "Install app" button. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState { canInstall: boolean; installed: boolean; iosHint: boolean }

let deferred: BeforeInstallPromptEvent | null = null;
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let snapshot: InstallState = { canInstall: false, installed: isStandalone(), iosHint: isIOS && !isStandalone() };
const listeners = new Set<() => void>();
function update(patch: Partial<InstallState>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

// Listen as early as possible: the event fires once, soon after load.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  update({ canInstall: true });
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  update({ canInstall: false, installed: true });
});

export function useInstall() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}

/** Opens the browser's install dialog. Returns true if the user installed the app. */
export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  update({ canInstall: false });
  return outcome === 'accepted';
}

/** Registers the service worker that caches the whole app for offline use. */
export function startOffline(onOfflineReady: () => void) {
  if (!('serviceWorker' in navigator)) return;
  registerSW({ immediate: true, onOfflineReady });
}
