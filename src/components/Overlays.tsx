import { dismissImport, useStore, type ImportStage } from '../state/store';
import { IconX } from './Icons';

const LABEL: Record<ImportStage, string> = {
  queued: 'Waiting…', reading: 'Reading file…', checking: 'Finding title and pages…', saving: 'Putting it on the shelf…',
  uploading: 'Sharing with everyone…', downloading: 'Downloading to this device…',
  done: 'Added', duplicate: 'Already on your shelf', error: 'Could not add',
};
const PROGRESS: Record<ImportStage, number> = { queued: 0.04, reading: 0.3, checking: 0.65, saving: 0.9, uploading: 0.6, downloading: 0.5, done: 1, duplicate: 1, error: 1 };

/** Small per-file progress cards while PDFs are processed (one at a time). */
export function ImportTray({ isPhone }: { isPhone: boolean }) {
  const jobs = useStore((s) => s.imports);
  if (!jobs.length) return null;
  return (
    <div className={'import-tray' + (isPhone ? ' phone' : '')} role="status" aria-live="polite">
      {jobs.slice(-4).map((j) => (
        <div key={j.id} className={'import-card ' + j.stage}>
          <div className="row between">
            <span className="import-name" title={j.name}>{j.name}</span>
            {(j.stage === 'error' || j.stage === 'duplicate' || j.stage === 'done') && (
              <button type="button" className="icon-btn xs" aria-label="Dismiss" onClick={() => dismissImport(j.id)}><IconX size={14} /></button>
            )}
          </div>
          <span className="import-stage">{j.message || LABEL[j.stage]}</span>
          <span className="import-bar"><span style={{ transform: `scaleX(${PROGRESS[j.stage]})` }} /></span>
        </div>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
  );
}
