import { useEffect, useRef, useState } from 'react';
import type { Book, Note } from '../lib/db';
import { copyText, downloadText, notesToMarkdown, notesToText, relativeTime, safeFileName } from '../lib/export';
import { deleteNote, toast, updateNote } from '../state/store';
import { IconCheck, IconCopy, IconDownload, IconEdit, IconTag, IconTrash } from './Icons';

export type NotesTab = 'book' | 'page' | 'export';

export function noteCounts(notes: Note[]) {
  return {
    notes: notes.filter((n) => n.text.trim()).length,
    highlights: notes.filter((n) => n.quote).length,
  };
}

export function sortNotes(notes: Note[]) {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function NoteCard({ note, active, onSelect }: { note: Note; active: boolean; onSelect: (n: Note) => void }) {
  const [editing, setEditing] = useState<'text' | 'tags' | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else { setEditing(null); setConfirm(false); }
  }, [active]);

  const save = () => {
    if (editing === 'text') void updateNote(note.id, { text: draft.trim() });
    if (editing === 'tags') {
      const tags = Array.from(new Set(draft.split(/[,#\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 12);
      void updateNote(note.id, { tags });
    }
    setEditing(null);
  };

  return (
    <article ref={ref} className={'note-card' + (active ? ' active' : '')} aria-current={active || undefined}>
      <button type="button" className="note-card-main" onClick={() => onSelect(note)}
        aria-label={`Go to page ${note.page}${note.text ? ': ' + note.text : ''}`}>
        <span className="note-meta">
          {note.color && <span className="note-color" style={{ background: note.color }} aria-hidden="true" />}
          p. {note.page} · {relativeTime(note.createdAt)}
        </span>
        {note.quote && <span className="note-quote">“{note.quote}”</span>}
        {note.text && editing !== 'text' && <span className="note-text">{note.text}</span>}
        {note.tags.length > 0 && editing !== 'tags' && (
          <span className="note-tags">{note.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</span>
        )}
      </button>
      {editing && (
        <form className="note-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {editing === 'text' ? (
            <textarea className="input" rows={3} maxLength={600} value={draft} autoFocus aria-label="Edit note"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') setEditing(null); }} />
          ) : (
            <input className="input sm" value={draft} autoFocus placeholder="exam, idea, quote" aria-label="Tags, separated by commas"
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
          )}
          <div className="row gap8">
            <button type="submit" className="btn btn-accent btn-sm">Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {active && !editing && (
        <div className="note-actions">
          <button type="button" className="chip-btn" onClick={() => { setDraft(note.text); setEditing('text'); }}>
            <IconEdit size={14} /> {note.text ? 'Edit' : 'Add note'}
          </button>
          <button type="button" className="chip-btn" onClick={() => { setDraft(note.tags.join(', ')); setEditing('tags'); }}>
            <IconTag size={14} /> Tags
          </button>
          <button type="button" className={'chip-btn danger' + (confirm ? ' confirm' : '')}
            onClick={() => { if (confirm) { void deleteNote(note.id); toast('Note deleted'); } else setConfirm(true); }}>
            <IconTrash size={14} /> {confirm ? 'Delete?' : 'Delete'}
          </button>
        </div>
      )}
    </article>
  );
}

export function NoteComposer({ page, attachedQuote, onSubmit, onCancelAttach, inputRef }: {
  page: number;
  attachedQuote?: string;
  onSubmit: (text: string) => void;
  onCancelAttach?: () => void;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const [text, setText] = useState('');
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; onSubmit(text.trim()); setText(''); }}>
      {attachedQuote && (
        <div className="composer-quote">
          <span>Note on “{attachedQuote.length > 60 ? attachedQuote.slice(0, 60) + '…' : attachedQuote}”</span>
          <button type="button" className="link-btn" onClick={onCancelAttach}>Cancel</button>
        </div>
      )}
      <div className="composer-row">
        <input ref={inputRef} className="input composer-input" value={text} maxLength={600}
          placeholder={attachedQuote ? 'Write your note…' : `Write a short note for p. ${page}...`}
          aria-label={`Write a short note for page ${page}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancelAttach?.()} />
        <button type="submit" className="btn btn-accent composer-send" aria-label="Save note" disabled={!text.trim()}>
          <IconCheck size={22} />
        </button>
      </div>
    </form>
  );
}

export function ExportPanel({ book, notes }: { book: Book; notes: Note[] }) {
  const name = safeFileName(book.title);
  return (
    <div className="export-panel">
      <p className="muted">Save the {notes.length} notes and highlights from this book.</p>
      <button type="button" className="btn btn-outline btn-block" disabled={!notes.length}
        onClick={() => downloadText(`${name} - notes.md`, notesToMarkdown(book, notes), 'text/markdown')}>
        <IconDownload size={18} /> Markdown (.md)
      </button>
      <button type="button" className="btn btn-outline btn-block" disabled={!notes.length}
        onClick={() => downloadText(`${name} - notes.txt`, notesToText(book, notes))}>
        <IconDownload size={18} /> Plain text (.txt)
      </button>
      <button type="button" className="btn btn-outline btn-block" disabled={!notes.length}
        onClick={async () => toast((await copyText(notesToMarkdown(book, notes))) ? 'Notes copied' : 'Could not copy')}>
        <IconCopy size={18} /> Copy all notes
      </button>
    </div>
  );
}

export function NotesTabs({ tab, setTab }: { tab: NotesTab; setTab: (t: NotesTab) => void }) {
  const tabs: [NotesTab, string][] = [['book', 'This book'], ['page', 'This page'], ['export', 'Export']];
  return (
    <div className="pill-tabs" role="tablist" aria-label="Notes">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className="pill-tab" onClick={() => setTab(id)}>{label}</button>
      ))}
    </div>
  );
}

interface PanelProps {
  book: Book;
  notes: Note[];
  visiblePages: number[];
  focusPage: number;
  activeNoteId: string | null;
  attachQuote?: string;
  onSelect: (n: Note) => void;
  onSubmit: (text: string) => void;
  onCancelAttach: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

/** Desktop right-hand notes panel. */
export function NotesPanel({ book, notes, visiblePages, focusPage, activeNoteId, attachQuote, onSelect, onSubmit, onCancelAttach, inputRef }: PanelProps) {
  const [tab, setTab] = useState<NotesTab>('book');
  const counts = noteCounts(notes);
  const list = sortNotes(tab === 'page' ? notes.filter((n) => visiblePages.includes(n.page)) : notes);
  return (
    <aside className="notes-panel" aria-label="My notes">
      <div className="notes-head">
        <h2 className="notes-title">My notes</h2>
        <span className="muted small">{counts.notes} {counts.notes === 1 ? 'note' : 'notes'} · {counts.highlights} {counts.highlights === 1 ? 'highlight' : 'highlights'}</span>
      </div>
      <NotesTabs tab={tab} setTab={setTab} />
      <div className="notes-list">
        {tab === 'export' ? <ExportPanel book={book} notes={notes} /> : list.length ? (
          list.map((n) => <NoteCard key={n.id} note={n} active={n.id === activeNoteId} onSelect={onSelect} />)
        ) : (
          <div className="notes-empty">
            <p>{tab === 'page' ? 'No notes on these pages yet.' : 'No notes yet.'}</p>
            <p className="muted small">Select text on the page to highlight it, or write a note below.</p>
          </div>
        )}
      </div>
      <NoteComposer page={focusPage} attachedQuote={attachQuote} onSubmit={onSubmit} onCancelAttach={onCancelAttach} inputRef={inputRef} />
    </aside>
  );
}
