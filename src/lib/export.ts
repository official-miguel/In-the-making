import type { Book, Note } from './db';
import { HIGHLIGHT_NAMES } from './colors';

function sorted(notes: Note[]) {
  return [...notes].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
}

export function notesToMarkdown(book: Book, notes: Note[]): string {
  const lines = [`# ${book.title}`, '', `${book.pageCount} pages · ${notes.length} notes · exported ${new Date().toLocaleDateString()}`, ''];
  for (const n of sorted(notes)) {
    lines.push(`## p. ${n.page}`);
    if (n.quote) lines.push(`> ${n.quote.replace(/\n+/g, ' ')}`);
    if (n.quote && n.color) lines.push(`*${HIGHLIGHT_NAMES[n.color] ?? 'Highlight'}*`);
    if (n.text) lines.push('', n.text);
    if (n.tags.length) lines.push('', n.tags.map((t) => `#${t}`).join(' '));
    lines.push('');
  }
  return lines.join('\n');
}

export function notesToText(book: Book, notes: Note[]): string {
  const lines = [book.title.toUpperCase(), ''];
  for (const n of sorted(notes)) {
    lines.push(`p. ${n.page}`);
    if (n.quote) lines.push(`  "${n.quote.replace(/\n+/g, ' ')}"`);
    if (n.text) lines.push(`  ${n.text}`);
    if (n.tags.length) lines.push(`  Tags: ${n.tags.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function allNotesToText(books: Book[], notes: Note[]): string {
  return books
    .map((b) => ({ b, ns: notes.filter((n) => n.bookId === b.id) }))
    .filter((x) => x.ns.length)
    .map((x) => notesToText(x.b, x.ns))
    .join('\n');
}

export function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notes';
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000, day = 86_400_000;
  if (diff < 2 * min) return 'just now';
  if (diff < 60 * min) return `${Math.floor(diff / min)} min ago`;
  const d = new Date(ts), now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return 'today';
  if (ts >= startToday - day) return 'yesterday';
  if (ts >= startToday - 6 * day) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
