import { useSyncExternalStore } from 'react';
import { db, type Book, type Bookmark, type Collection, type Note, type ReadingMode } from '../lib/db';
import { hashFile, uid } from '../lib/hash';
import { analyzePdf, closeDocument } from '../lib/pdf';
import { colorForTitle, spineHeightForTitle } from '../lib/colors';

export type Theme = 'night' | 'day' | 'sepia';

export interface Settings {
  appTheme: Theme;
  paperTheme: Theme;
  pageAnimation: boolean;
  defaultMode: ReadingMode;
  coverFromFirstPage: boolean;
  /** Download every shared book to this device so the whole library works offline. */
  keepOffline: boolean;
}

export interface Session { userId: string; email: string }

export type ImportStage = 'queued' | 'reading' | 'checking' | 'saving' | 'uploading' | 'downloading' | 'done' | 'duplicate' | 'error';
export interface ImportJob { id: string; name: string; stage: ImportStage; message?: string }

export interface Toast { id: string; text: string }

export interface State {
  ready: boolean;
  books: Book[];
  collections: Collection[];
  notes: Note[];
  bookmarks: Bookmark[];
  settings: Settings;
  imports: ImportJob[];
  toasts: Toast[];
  /** Signed-in user for the shared library (null = signed out). */
  session: Session | null;
}

const DEFAULT_SETTINGS: Settings = {
  appTheme: 'night',
  paperTheme: 'day',
  pageAnimation: true,
  defaultMode: 'book',
  coverFromFirstPage: false,
  keepOffline: false,
};

let state: State = {
  ready: false, books: [], collections: [], notes: [], bookmarks: [],
  settings: DEFAULT_SETTINGS, imports: [], toasts: [], session: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
/** For the sync module only. */
export const patchState = set;
export function getState() { return state; }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ---------- init ----------

let initOnce: Promise<void> | null = null;
export function init() {
  if (!initOnce) initOnce = load();
  return initOnce;
}

async function load() {
  const d = await db();
  const [books, collections, notes, bookmarks, saved] = await Promise.all([
    d.getAll('books'), d.getAll('collections'), d.getAll('notes'), d.getAll('bookmarks'), d.get('kv', 'settings'),
  ]);
  let cols = collections.sort((a, b) => a.orderIndex - b.orderIndex);
  // Merge accidental empty duplicates of the default row.
  const dupes = cols.filter((c, i) => i > 0 && c.name === cols[0].name && !books.some((b) => b.collectionId === c.id));
  for (const c of dupes) await d.delete('collections', c.id);
  cols = cols.filter((c) => !dupes.includes(c));
  if (!cols.length) {
    const c: Collection = { id: uid(), name: 'Study', orderIndex: 0 };
    await d.put('collections', c);
    cols = [c];
  }
  // Books whose collection disappeared go to the first row.
  const colIds = new Set(cols.map((c) => c.id));
  for (const b of books) if (!colIds.has(b.collectionId)) b.collectionId = cols[0].id;
  set({
    ready: true,
    books: sortBooks(books),
    collections: cols.sort((a, b) => a.orderIndex - b.orderIndex),
    notes,
    bookmarks,
    settings: { ...DEFAULT_SETTINGS, ...((saved as Partial<Settings>) || {}) },
  });
}

export function sortBooks(b: Book[]) {
  return [...b].sort((x, y) => x.orderIndex - y.orderIndex || x.createdAt - y.createdAt);
}

// ---------- toasts ----------

export function toast(text: string) {
  const t = { id: uid(), text };
  set({ toasts: [...state.toasts, t] });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 3200);
}

// ---------- settings ----------

export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  await (await db()).put('kv', settings, 'settings');
}

// ---------- importing ----------

let queue: { job: ImportJob; file: File; collectionId?: string }[] = [];
let running = false;

function setJob(id: string, patch: Partial<ImportJob>) {
  set({ imports: state.imports.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
}

export function addFiles(files: FileList | File[], collectionId?: string) {
  const list = Array.from(files).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!list.length) {
    toast('Only PDF files can go on the shelf');
    return;
  }
  for (const file of list) {
    const job: ImportJob = { id: uid(), name: file.name, stage: 'queued' };
    queue.push({ job, file, collectionId });
    set({ imports: [...state.imports, job] });
  }
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const next = queue.shift()!;
    await importOne(next.job, next.file, next.collectionId);
  }
  running = false;
  // Clear finished jobs after a moment.
  setTimeout(() => {
    if (!running) set({ imports: state.imports.filter((j) => ['queued', 'reading', 'checking', 'saving', 'uploading', 'downloading'].includes(j.stage)) });
  }, 2600);
}

async function importOne(job: ImportJob, file: File, collectionId?: string) {
  try {
    setJob(job.id, { stage: 'reading' });
    const fileHash = await hashFile(file);
    const d = await db();
    const existing = await d.getFromIndex('books', 'fileHash', fileHash);
    if (existing) {
      setJob(job.id, { stage: 'duplicate', message: `Already on your shelf as “${existing.title}”` });
      return;
    }
    setJob(job.id, { stage: 'checking' });
    const info = await analyzePdf(file);
    setJob(job.id, { stage: 'saving' });
    const colId = collectionId || state.collections[state.collections.length - 1]?.id || state.collections[0].id;
    const maxOrder = Math.max(0, ...state.books.map((b) => b.orderIndex));
    const book: Book = {
      id: uid(),
      fileHash,
      title: info.title,
      author: info.author,
      pageCount: info.pageCount,
      color: colorForTitle(info.title),
      spineHeight: spineHeightForTitle(info.title),
      createdAt: Date.now(),
      lastOpenedAt: 0,
      lastPage: 1,
      readingMode: info.hasText ? state.settings.defaultMode : 'book',
      collectionId: colId,
      orderIndex: maxOrder + 1,
      hasText: info.hasText,
      fileName: file.name,
      cloud: 'local',
      sizeBytes: file.size,
    };
    const tx = d.transaction(['books', 'files'], 'readwrite');
    await Promise.all([tx.objectStore('books').put(book), tx.objectStore('files').put({ id: book.id, pdfBlob: file }), tx.done]);
    set({ books: sortBooks([...state.books, book]) });
    setJob(job.id, { stage: 'done' });
    // Share it with everyone (when signed in and online).
    void import('./sync').then((m) => m.requestSync());
  } catch (err) {
    console.error(err);
    const msg = /password/i.test(String(err)) ? 'This PDF is password protected' : 'Could not read this PDF';
    setJob(job.id, { stage: 'error', message: msg });
  }
}

export function dismissImport(id: string) {
  set({ imports: state.imports.filter((j) => j.id !== id) });
}

// ---------- books ----------

export async function updateBook(id: string, patch: Partial<Book>) {
  const b = state.books.find((x) => x.id === id);
  if (!b) return;
  const nb = { ...b, ...patch };
  set({ books: sortBooks(state.books.map((x) => (x.id === id ? nb : x))) });
  await (await db()).put('books', nb);
  // The uploader's title and colour changes are shared with everyone.
  if ((patch.title || patch.color) && b.remoteId && b.uploadedBy && b.uploadedBy === state.session?.userId) {
    void import('../lib/cloud').then((c) => c.updateRemote(b.remoteId!, { title: nb.title, color: nb.color })).catch(() => {});
  }
}

/** Can the current user remove this book for everyone? */
export function canRemoveForEveryone(b: Book) {
  return !!b.remoteId && !!state.session && b.uploadedBy === state.session.userId;
}

/**
 * Remove a book from this shelf. Your own shared books are removed for everyone;
 * someone else's shared book is only hidden on this device.
 */
export async function deleteBook(id: string) {
  const d = await db();
  const book = state.books.find((b) => b.id === id);
  if (book?.remoteId) {
    if (canRemoveForEveryone(book)) {
      if (!navigator.onLine) { toast('Connect to the internet to remove a shared book'); return; }
      try {
        const { deleteRemote } = await import('../lib/cloud');
        await deleteRemote({ remoteId: book.remoteId, remotePath: book.remotePath });
      } catch { toast('Could not remove it from the shared library'); return; }
    } else {
      const hidden = ((await d.get('kv', 'hiddenRemote')) as string[] | undefined) ?? [];
      await d.put('kv', [...new Set([...hidden, book.remoteId])], 'hiddenRemote');
    }
  }
  const tx = d.transaction(['books', 'files', 'covers', 'notes', 'bookmarks'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  tx.objectStore('covers').delete(id);
  for (const n of state.notes.filter((n) => n.bookId === id)) tx.objectStore('notes').delete(n.id);
  for (const m of state.bookmarks.filter((m) => m.bookId === id)) tx.objectStore('bookmarks').delete(m.id);
  await tx.done;
  closeDocument(id);
  set({
    books: state.books.filter((b) => b.id !== id),
    notes: state.notes.filter((n) => n.bookId !== id),
    bookmarks: state.bookmarks.filter((m) => m.bookId !== id),
  });
}

/** Move a book into a collection, before another book (or at the end). */
export async function moveBook(id: string, collectionId: string, beforeId: string | null) {
  const moving = state.books.find((b) => b.id === id);
  if (!moving || id === beforeId) return;
  const rest = state.books.filter((b) => b.id !== id);
  const ordered: Book[] = [];
  let placed = false;
  for (const b of rest) {
    if (b.id === beforeId) { ordered.push({ ...moving, collectionId }); placed = true; }
    ordered.push(b);
  }
  if (!placed) {
    // End of the target collection: after its last book.
    let lastIdx = -1;
    ordered.forEach((b, i) => { if (b.collectionId === collectionId) lastIdx = i; });
    ordered.splice(lastIdx + 1 || ordered.length, 0, { ...moving, collectionId });
  }
  const books = ordered.map((b, i) => ({ ...b, orderIndex: i }));
  set({ books });
  const d = await db();
  const tx = d.transaction('books', 'readwrite');
  await Promise.all([...books.map((b) => tx.store.put(b)), tx.done]);
}

export async function markOpened(id: string) {
  await updateBook(id, { lastOpenedAt: Date.now() });
}

// ---------- collections ----------

export async function addCollection(name: string) {
  const c: Collection = { id: uid(), name: name.trim() || 'New row', orderIndex: state.collections.length };
  set({ collections: [...state.collections, c] });
  await (await db()).put('collections', c);
  return c;
}

export async function renameCollection(id: string, name: string) {
  const collections = state.collections.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c));
  set({ collections });
  const c = collections.find((x) => x.id === id);
  if (c) await (await db()).put('collections', c);
}

export async function deleteCollection(id: string) {
  if (state.collections.length <= 1) return;
  const target = state.collections.find((c) => c.id !== id)!;
  const d = await db();
  for (const b of state.books.filter((b) => b.collectionId === id)) await updateBook(b.id, { collectionId: target.id });
  set({ collections: state.collections.filter((c) => c.id !== id) });
  await d.delete('collections', id);
}

// ---------- notes ----------

export async function addNote(n: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'tags'> & { tags?: string[] }) {
  const note: Note = { tags: [], ...n, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
  set({ notes: [...state.notes, note] });
  await (await db()).put('notes', note);
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  const nn = { ...n, ...patch, updatedAt: Date.now() };
  set({ notes: state.notes.map((x) => (x.id === id ? nn : x)) });
  await (await db()).put('notes', nn);
}

export async function deleteNote(id: string) {
  set({ notes: state.notes.filter((x) => x.id !== id) });
  await (await db()).delete('notes', id);
}

// ---------- bookmarks ----------

export async function toggleBookmark(bookId: string, page: number) {
  const existing = state.bookmarks.find((b) => b.bookId === bookId && b.page === page);
  const d = await db();
  if (existing) {
    set({ bookmarks: state.bookmarks.filter((b) => b.id !== existing.id) });
    await d.delete('bookmarks', existing.id);
    return false;
  }
  const bm: Bookmark = { id: uid(), bookId, page, createdAt: Date.now() };
  set({ bookmarks: [...state.bookmarks, bm] });
  await d.put('bookmarks', bm);
  return true;
}

// ---------- backup ----------

interface Backup {
  app: 'bookshelf-reader';
  version: 1;
  exportedAt: string;
  settings: Settings;
  collections: Collection[];
  books: Omit<Book, never>[];
  notes: Note[];
  bookmarks: Bookmark[];
}

export function makeBackup(): Backup {
  return {
    app: 'bookshelf-reader', version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, collections: state.collections, books: state.books,
    notes: state.notes, bookmarks: state.bookmarks,
  };
}

/** Restores notes, bookmarks, progress and rows. PDFs are matched by file hash (they are not in the backup). */
export async function restoreBackup(data: unknown): Promise<string> {
  const b = data as Backup;
  if (!b || b.app !== 'bookshelf-reader' || !Array.isArray(b.notes)) throw new Error('Not a Better Me backup file');
  const d = await db();
  // Collections
  for (const c of b.collections || []) {
    if (!state.collections.some((x) => x.id === c.id)) {
      await d.put('collections', c);
      set({ collections: [...state.collections, c].sort((x, y) => x.orderIndex - y.orderIndex) });
    }
  }
  // Map backup book ids to local books by file hash.
  const idMap = new Map<string, string>();
  for (const bb of b.books || []) {
    const local = state.books.find((x) => x.fileHash === bb.fileHash);
    if (!local) continue;
    idMap.set(bb.id, local.id);
    await updateBook(local.id, {
      lastPage: Math.max(local.lastPage, bb.lastPage), title: bb.title, color: bb.color,
      collectionId: state.collections.some((c) => c.id === bb.collectionId) ? bb.collectionId : local.collectionId,
    });
  }
  let added = 0;
  for (const n of b.notes) {
    const bookId = idMap.get(n.bookId);
    if (!bookId || state.notes.some((x) => x.id === n.id)) continue;
    const nn = { ...n, bookId };
    await d.put('notes', nn);
    set({ notes: [...state.notes, nn] });
    added++;
  }
  for (const m of b.bookmarks || []) {
    const bookId = idMap.get(m.bookId);
    if (!bookId || state.bookmarks.some((x) => x.id === m.id)) continue;
    const mm = { ...m, bookId };
    await d.put('bookmarks', mm);
    set({ bookmarks: [...state.bookmarks, mm] });
  }
  if (b.settings) await updateSettings(b.settings);
  const missing = (b.books || []).length - idMap.size;
  return `Restored ${added} note${added === 1 ? '' : 's'}` + (missing > 0 ? `. ${missing} book${missing === 1 ? ' is' : 's are'} not on this shelf yet — add the PDF and import again.` : '.');
}
