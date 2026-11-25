import { useRef, useState } from 'react';
import { cloud, sendSignInLink, signOut } from '../lib/cloud';
import { requestSync } from '../state/sync';
import { downloadText } from '../lib/export';
import { makeBackup, restoreBackup, toast, updateSettings, useStore, type Theme } from '../state/store';
import { IconDownload, IconUpload, IconX } from './Icons';
import { InstallSetting } from './Install';

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="setting">
      <span className="setting-label" id={`lbl-${label}`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`lbl-${label}`}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting toggle-row">
      <span>
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.settings);
  const fileRef = useRef<HTMLInputElement>(null);
  const themes: [Theme, string][] = [['night', 'Night'], ['day', 'Day'], ['sepia', 'Sepia']];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="dialog-panel settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="all-notes-head">
          <h2 className="brand-title">Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose} autoFocus><IconX /></button>
        </header>
        <InstallSetting />
        <AccountSetting />
        <Segmented label="App theme" value={s.appTheme} options={themes} onChange={(v) => updateSettings({ appTheme: v })} />
        <Segmented label="Page colour" value={s.paperTheme} options={[['day', 'Day'], ['sepia', 'Sepia'], ['night', 'Night']]} onChange={(v) => updateSettings({ paperTheme: v })} />
        <Segmented label="Default reading mode" value={s.defaultMode} options={[['book', 'Book'], ['text', 'Text']]} onChange={(v) => updateSettings({ defaultMode: v })} />
        <Toggle label="Page-turn animation" hint="Curl pages when turning. Off uses a soft fade." checked={s.pageAnimation} onChange={(v) => updateSettings({ pageAnimation: v })} />
        {cloud && <Toggle label="Keep the whole library on this device" hint="Downloads every shared book so all of them open offline. Uses storage." checked={s.keepOffline} onChange={(v) => { void updateSettings({ keepOffline: v }); if (v) requestSync(50); }} />}
        <Toggle label="Use first page of the PDF as cover" hint="Shown small on the designed cover, never stretched." checked={s.coverFromFirstPage} onChange={(v) => updateSettings({ coverFromFirstPage: v })} />
        <div className="setting column">
          <span className="setting-label">Backup</span>
          <span className="setting-hint">Notes, bookmarks, rows and reading progress. PDFs stay on this device.</span>
          <div className="row gap8 wrap">
            <button type="button" className="btn btn-outline" onClick={() => {
              downloadText(`better-me-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(), null, 2), 'application/json');
            }}><IconDownload size={18} /> Export backup</button>
            <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}><IconUpload size={18} /> Import backup</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try { toast(await restoreBackup(JSON.parse(await f.text()))); } catch (err) { toast((err as Error).message || 'That file could not be read'); }
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sign in to share the books you add with everyone. Reading the library needs no account. */
function AccountSetting() {
  const session = useStore((st) => st.session);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  if (!cloud) {
    return (
      <div className="setting column">
        <span className="setting-label">Shared library</span>
        <span className="setting-hint">Not connected yet. Books stay on this device.</span>
      </div>
    );
  }
  if (session) {
    return (
      <div className="setting">
        <span>
          <span className="setting-label">Shared library</span>
          <span className="setting-hint">Signed in as {session.email}. Books you add are shared with everyone.</span>
        </span>
        <button type="button" className="btn btn-outline" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }
  return (
    <form className="setting column" onSubmit={async (e) => {
      e.preventDefault();
      setState('sending');
      try { await sendSignInLink(email.trim()); setState('sent'); }
      catch (err) { setState('idle'); toast((err as Error).message || 'Could not send the link'); }
    }}>
      <span className="setting-label">Shared library</span>
      <span className="setting-hint">
        {state === 'sent'
          ? `Check ${email} and tap the link to sign in.`
          : 'Everyone can read the library. Sign in with your email to add books for everyone.'}
      </span>
      {state !== 'sent' && (
        <div className="row gap8" style={{ width: '100%' }}>
          <input className="input grow" type="email" required autoComplete="email" placeholder="you@example.com"
            aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn btn-accent" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send link'}</button>
        </div>
      )}
    </form>
  );
}
