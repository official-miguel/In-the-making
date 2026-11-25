import { useState } from 'react';
import { installApp, useInstall } from '../lib/pwa';
import { toast } from '../state/store';
import { IconDownload, IconX } from './Icons';

const install = async () => {
  if (await installApp()) toast('Better Me is installed — it works offline');
};

/** Desktop top-bar button. Only shown when the browser can install the app. */
export function InstallButton() {
  const { canInstall } = useInstall();
  if (!canInstall) return null;
  return (
    <button type="button" className="btn btn-outline" onClick={install}>
      <IconDownload size={18} /> Install app
    </button>
  );
}

/** Phone banner: install prompt on Android, "Add to Home Screen" steps on iPhone. */
export function InstallBanner() {
  const { canInstall, iosHint, installed } = useInstall();
  const [hidden, setHidden] = useState(() => localStorage.getItem('install-banner-hidden') === '1');
  if (installed || hidden || (!canInstall && !iosHint)) return null;
  const close = () => { localStorage.setItem('install-banner-hidden', '1'); setHidden(true); };
  return (
    <div className="install-banner" role="region" aria-label="Install Better Me">
      <img src="/icons/icon-192.png" alt="" width={40} height={40} />
      <div className="install-banner-body">
        <span className="install-banner-title">Get the Better Me app</span>
        <span className="install-banner-text">
          {canInstall ? 'Install it on this phone. Your books and notes work offline.' : 'Tap Share, then “Add to Home Screen”. It works offline.'}
        </span>
      </div>
      {canInstall && <button type="button" className="btn btn-accent btn-sm" onClick={install}>Install</button>}
      <button type="button" className="icon-btn sm" aria-label="Hide install banner" onClick={close}><IconX size={16} /></button>
    </div>
  );
}

/** Settings row: always explains the current state. */
export function InstallSetting() {
  const { canInstall, iosHint, installed } = useInstall();
  return (
    <div className="setting column">
      <span className="setting-label">App</span>
      <span className="setting-hint">
        {installed ? 'Better Me is installed on this device and works offline.'
          : canInstall ? 'Install Better Me to open it like any other app, even with no internet.'
            : iosHint ? 'On iPhone or iPad: tap Share, then “Add to Home Screen”.'
              : 'Works offline in this browser. To install, use your browser menu (“Install app” or “Add to Home screen”).'}
      </span>
      {canInstall && (
        <button type="button" className="btn btn-accent" onClick={install}><IconDownload size={18} /> Install app</button>
      )}
    </div>
  );
}
