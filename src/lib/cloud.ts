import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The shared library (Supabase). Everyone sees every book; signed-in users upload.
 * Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app simply works on this device only.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloud: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

const BUCKET = 'betterme-books';
const TABLE = 'betterme_books';

export interface RemoteBook {
  id: string;
  file_hash: string;
  title: string;
  author: string | null;
  page_count: number;
  color: string;
  spine_height: number;
  has_text: boolean;
  file_name: string | null;
  storage_path: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

export function cloudReady() {
  return !!cloud && navigator.onLine;
}

export async function listRemote(): Promise<RemoteBook[]> {
  if (!cloud) return [];
  const { data, error } = await cloud.from(TABLE).select('*').order('created_at', { ascending: true }).limit(5000);
  if (error) throw error;
  return data as RemoteBook[];
}

export async function currentUserId(): Promise<string | null> {
  if (!cloud) return null;
  const { data } = await cloud.auth.getSession();
  return data.session?.user.id ?? null;
}

export interface UploadMeta {
  fileHash: string; title: string; author?: string; pageCount: number; color: string;
  spineHeight: number; hasText: boolean; fileName?: string;
}

/** Upload a PDF to the shared library. If someone already shared the same file, returns their copy. */
export async function uploadRemote(file: Blob, meta: UploadMeta): Promise<RemoteBook> {
  if (!cloud) throw new Error('Shared library is not connected');
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to share books');

  const existing = await cloud.from(TABLE).select('*').eq('file_hash', meta.fileHash).maybeSingle();
  if (existing.data) return existing.data as RemoteBook;

  const path = `${userId}/${meta.fileHash}.pdf`;
  const up = await cloud.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) {
    if (/size|too large|exceeded/i.test(up.error.message)) throw new Error('Too large for the shared library');
    throw up.error;
  }
  const row = {
    file_hash: meta.fileHash, title: meta.title.slice(0, 300), author: meta.author?.slice(0, 200) ?? null,
    page_count: meta.pageCount, color: meta.color, spine_height: meta.spineHeight, has_text: meta.hasText,
    file_name: meta.fileName ?? null, storage_path: path, size_bytes: file.size, uploaded_by: userId,
  };
  const ins = await cloud.from(TABLE).insert(row).select('*').single();
  if (ins.error) {
    // Someone shared the same file at the same moment: use theirs, drop our copy.
    const again = await cloud.from(TABLE).select('*').eq('file_hash', meta.fileHash).maybeSingle();
    if (again.data) {
      await cloud.storage.from(BUCKET).remove([path]);
      return again.data as RemoteBook;
    }
    throw ins.error;
  }
  return ins.data as RemoteBook;
}

export async function downloadRemote(path: string): Promise<Blob> {
  if (!cloud) throw new Error('Shared library is not connected');
  const { data, error } = await cloud.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('Download failed');
  return data.type === 'application/pdf' ? data : new Blob([data], { type: 'application/pdf' });
}

export async function updateRemote(id: string, patch: { title?: string; color?: string }) {
  if (!cloud) return;
  await cloud.from(TABLE).update(patch).eq('id', id);
}

export async function deleteRemote(book: { remoteId: string; remotePath?: string }) {
  if (!cloud) return;
  const { error } = await cloud.from(TABLE).delete().eq('id', book.remoteId);
  if (error) throw error;
  if (book.remotePath) await cloud.storage.from(BUCKET).remove([book.remotePath]);
}

/** Calls back whenever anyone adds, edits or removes a shared book. */
export function onRemoteChange(cb: () => void): () => void {
  if (!cloud) return () => {};
  const ch = cloud.channel('betterme-books-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => cb())
    .subscribe();
  return () => { void cloud.removeChannel(ch); };
}

export async function sendSignInLink(email: string) {
  if (!cloud) throw new Error('Shared library is not connected');
  const { error } = await cloud.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) throw error;
}

export async function signOut() {
  await cloud?.auth.signOut();
}
