import type { Session as AuthSession } from '@supabase/supabase-js';
import { cloud, downloadRemote, DuplicateBookError, listRemote, onRemoteChange, uploadRemote, type RemoteBook } from '../lib/cloud';
import { titleKey } from '../lib/titles';
import { db, getPdfBlob, type Book } from '../lib/db';
import { uid } from '../lib/hash';
import { getState, init, mergeBookInto, patchState, sortBooks, toast, updateBook, type ImportJob } from './store';

/**
 * Keeps this device's shelf in step with the shared library:
 *  - every shared book appears here (the PDF downloads when first opened, or all at once with "keep offline"),
 *  - books added here are uploaded for everyone once you are signed in,
 *  - everything keeps working offline and catches up when the connection returns.
 */

let timer = 0;
export function requestSync(delay = 400) {
  if (!cloud) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delay);
}

function setSession(s: AuthSession | null) {
  const next = s ? { userId: s.user.id, email: s.user.email ?? '' } : null;
  const cur = getState().session;
  if (cur?.userId !== next?.userId || cur?.email !== next?.email) patchState({ session: next });
}

/**
 * Every device gets its own anonymous account automatically (no email, no password),
 * so books added on any device are shared with everyone straight away.
 * Signing in with email is optional (it lets you manage your books from several devices).
 */
async function ensureDeviceAccount() {
  if (!cloud || !navigator.onLine) return;
  const { data } = await cloud.auth.getSession();
  if (data.session) { setSession(data.session); return; }
  const { data: anon, error } = await cloud.auth.signInAnonymously();
  if (error) {
    console.warn('Anonymous sign-in failed', error);
    patchState({ syncProblem: /anonymous/i.test(error.message)
      ? 'Automatic sharing is switched off in Supabase (Allow anonymous sign-ins).'
      : 'Could not connect to the shared library.' });
    return;
  }
  patchState({ syncProblem: null });
  setSession(anon.session);
}

export function startSync() {
  if (!cloud) return;
  void ensureDeviceAccount().then(() => requestSync(50));
  // Never call Supabase inside this callback (it can deadlock); just schedule.
  cloud.auth.onAuthStateChange((event, s) => {
    setSession(s);
    if (event === 'SIGNED_IN' && s?.user.email) toast(`Signed in as ${s.user.email}`);
    if (event === 'SIGNED_OUT') setTimeout(() => void ensureDeviceAccount(), 0);
    requestSync(100);
  });
  window.addEventListener('online', () => { void ensureDeviceAccount(); requestSync(100); });
  onRemoteChange(() => requestSync(300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(200); });
  requestSync(50);
}

function job(name: string, stage: ImportJob['stage']): string {
  const j: ImportJob = { id: uid(), name, stage };
  patchState({ imports: [...getState().imports, j] });
  return j.id;
}
function setJob(id: string, patch: Partial<ImportJob>) {
  patchState({ imports: getState().imports.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
}
function clearJobSoon(id: string) {
  setTimeout(() => patchState({ imports: getState().imports.filter((j) => j.id !== id) }), 2600);
}

function fromRemote(r: RemoteBook, collectionId: string, orderIndex: number): Book {
  return {
    id: uid(), fileHash: r.file_hash, title: r.title, author: r.author ?? undefined, pageCount: r.page_count,
    color: r.color, spineHeight: r.spine_height, createdAt: Date.parse(r.created_at) || Date.now(),
    lastOpenedAt: 0, lastPage: 1, readingMode: r.has_text ? getState().settings.defaultMode : 'book',
    collectionId, orderIndex, hasText: r.has_text, fileName: r.file_name ?? undefined,
    cloud: 'remote', remoteId: r.id, remotePath: r.storage_path, uploadedBy: r.uploaded_by, sizeBytes: r.size_bytes,
  };
}

let running = false;
let again = false;

export async function syncNow() {
  if (!cloud || !navigator.onLine) return;
  if (running) { again = true; return; }
  running = true;
  try {
    await init();
    const remote = await listRemote();
    const d = await db();
    const hidden = new Set(((await d.get('kv', 'hiddenRemote')) as string[] | undefined) ?? []);
    const me = getState().session?.userId;
    const byHash = new Map(remote.map((r) => [r.file_hash, r]));
    const current = getState().books;

    const changed: Book[] = [];
    const removed: string[] = [];
    for (const b of current) {
      const r = byHash.get(b.fileHash);
      if (r) {
        const linked: Book = {
          ...b, remoteId: r.id, remotePath: r.storage_path, uploadedBy: r.uploaded_by,
          cloud: b.cloud === 'remote' ? 'remote' : 'synced',
          // Shared title/colour come from the uploader.
          ...(r.uploaded_by !== me ? { title: r.title, color: r.color } : {}),
        };
        if (JSON.stringify(linked) !== JSON.stringify(b)) changed.push(linked);
      } else if (b.remoteId) {
        // Removed from the shared library by its uploader.
        if (b.cloud === 'remote') removed.push(b.id);
        else changed.push({ ...b, remoteId: undefined, remotePath: undefined, uploadedBy: undefined, cloud: 'local' });
      }
    }

    const have = new Set(current.map((b) => b.fileHash));
    const firstRow = getState().collections[0]?.id;
    let order = Math.max(0, ...current.map((b) => b.orderIndex));
    const added = firstRow
      ? remote.filter((r) => !have.has(r.file_hash) && !hidden.has(r.id)).map((r) => fromRemote(r, firstRow, ++order))
      : [];

    if (changed.length || removed.length || added.length) {
      const tx = d.transaction('books', 'readwrite');
      await Promise.all([...changed, ...added].map((b) => tx.store.put(b)));
      await Promise.all(removed.map((id) => tx.store.delete(id)));
      await tx.done;
      const map = new Map(getState().books.map((b) => [b.id, b]));
      for (const b of changed) map.set(b.id, b);
      for (const b of added) map.set(b.id, b);
      for (const id of removed) map.delete(id);
      patchState({ books: sortBooks([...map.values()]) });
      if (added.length) toast(added.length === 1 ? `New in the library: “${added[0].title}”` : `${added.length} new books in the library`);

      // A book only on this device that the library also has (same title): keep one copy, the library's.
      for (const a of added) {
        const key = titleKey(a.title);
        const localTwin = key && getState().books.find((x) => x.id !== a.id && !x.remoteId && titleKey(x.title) === key);
        if (localTwin) await mergeBookInto(localTwin.id, a.id);
      }
    }

    // Share books that are only on this device.
    if (me) {
      for (const b of getState().books.filter((x) => !x.remoteId && !x.shareBlocked && (x.cloud ?? 'local') === 'local')) {
        if (!navigator.onLine) break;
        await shareBook(b);
      }
    }

    // Optionally keep every shared PDF on this device for offline reading.
    if (getState().settings.keepOffline) {
      for (const b of getState().books.filter((x) => x.cloud === 'remote')) {
        if (!navigator.onLine) break;
        await ensureLocalFile(b).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('Shared library sync failed', e);
  } finally {
    running = false;
    if (again) { again = false; requestSync(200); }
  }
}

async function shareBook(b: Book) {
  const blob = await getPdfBlob(b.id);
  if (!blob) return;
  const id = job(b.title, 'uploading');
  try {
    const r = await uploadRemote(blob, {
      fileHash: b.fileHash, title: b.title, author: b.author, pageCount: b.pageCount, color: b.color,
      spineHeight: b.spineHeight, hasText: b.hasText ?? true, fileName: b.fileName,
    });
    await updateBook(b.id, { remoteId: r.id, remotePath: r.storage_path, uploadedBy: r.uploaded_by, cloud: 'synced' });
    setJob(id, { stage: 'done', message: 'Shared with everyone' });
  } catch (e) {
    if (e instanceof DuplicateBookError) {
      // Someone else already shared this book: use the library's copy and keep this reader's notes.
      const key = titleKey(b.title);
      const twin = getState().books.find((x) => x.id !== b.id && x.remoteId && titleKey(x.title) === key);
      if (twin) {
        await mergeBookInto(b.id, twin.id);
        setJob(id, { stage: 'duplicate', message: `Already in the library — your notes moved to “${twin.title}”` });
      } else {
        await updateBook(b.id, { shareBlocked: true });
        setJob(id, { stage: 'duplicate', message: e.message });
      }
    } else {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      const tooBig = /large/i.test(msg);
      if (tooBig) await updateBook(b.id, { shareBlocked: true });
      setJob(id, { stage: 'error', message: tooBig ? 'Too large to share — kept on this device' : 'Not shared yet — will retry' });
    }
  }
  clearJobSoon(id);
}

/** Make sure the PDF is stored on this device (downloads shared books the first time). */
export async function ensureLocalFile(b: Book): Promise<Blob> {
  const local = await getPdfBlob(b.id);
  if (local) return local;
  if (!b.remotePath || !cloud) throw new Error('missing');
  if (!navigator.onLine) throw new Error('offline');
  const id = job(b.title, 'downloading');
  try {
    const blob = await downloadRemote(b.remotePath);
    await (await db()).put('files', { id: b.id, pdfBlob: blob });
    await updateBook(b.id, { cloud: 'synced' });
    setJob(id, { stage: 'done', message: 'Saved on this device' });
    clearJobSoon(id);
    return blob;
  } catch (e) {
    setJob(id, { stage: 'error', message: 'Download failed' });
    clearJobSoon(id);
    throw e;
  }
}
