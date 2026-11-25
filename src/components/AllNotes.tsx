import { useMemo, useState } from 'react';
import type { Book } from '../lib/db';
import { allNotesToText, copyText, relativeTime } from '../lib/export';
import { toast, toggleBookmark, useStore } from '../state/store';
import { IconCopy, IconSearch, IconTrash, IconX } from './Icons';

interface Props {
  tab: 'notes' | 'saved';
  setTab?: (t: 'notes' | 'saved') => void;
  isPhone: boolean;
  onOpen: (book: Book, page: number, noteId?: string) => void;
  onClose?: () => void;
}

/** Every note across the library, with search; and the "Saved" bookmarks list. */
export function AllNotes({ tab, setTab, isPhone, onOpen, onClose }: Props) {
  const books = useStore((s) => s.books);
  const notes = useStore((s) => s.notes);
  const bookmarks = useStore((s) => s.bookmarks);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = notes.filter((n) => !needle || n.text.toLowerCase().includes(needle) || n.quote?.toLowerCase().includes(needle)
      || n.tags.some((t) => t.includes(needle)) || books.find((b) => b.id === n.bookId)?.title.toLowerCase().includes(needle));
    return books
      .map((b) => ({ book: b, notes: filtered.filter((n) => n.bookId === b.id).sort((x, y) => x.page - y.page) }))
      .filter((g) => g.notes.length);
  }, [books, notes, q]);

  const savedGroups = useMemo(() => books
    .map((b) => ({ book: b, marks: bookmarks.filter((m) => m.bookId === b.id).sort((x, y) => x.page - y.page) }))
    .filter((g) => g.marks.length), [books, bookmarks]);

  return (
    <div className={'all-notes' + (isPhone ? ' phone' : ' dialog-panel')} role={isPhone ? undefined : 'dialog'} aria-label="All notes">
      <header className="all-notes-head">
        <h2 className="brand-title">{tab === 'notes' ? 'All notes' : 'Saved'}</h2>
        {onClose && <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconX /></button>}
      </header>
      {setTab && !isPhone && (
        <div className="pill-tabs" role="tablist">
          <button type="button" role="tab" className="pill-tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>Notes</button>
          <button type="button" role="tab" className="pill-tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')}>Bookmarks</button>
        </div>
      )}
      {tab === 'notes' ? (
        <>
          <div className="row gap8">
            <div className="search-field grow">
              <IconSearch size={18} className="search-icon" />
              <input type="search" className="search-input" placeholder="Search all notes" aria-label="Search all notes"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button type="button" className="icon-btn outline" aria-label="Copy all notes" title="Copy all notes" disabled={!notes.length}
              onClick={async () => toast((await copyText(allNotesToText(books, notes))) ? 'All notes copied' : 'Could not copy')}>
              <IconCopy />
            </button>
          </div>
          <div className="all-notes-list">
            {!groups.length && <p className="muted notes-empty">{notes.length ? 'No notes match your search.' : 'Your notes from every book will gather here. Open a book and select some text to start.'}</p>}
            {groups.map(({ book, notes: ns }) => (
              <section key={book.id} className="note-group">
                <h3 className="note-group-title"><span className="dot" style={{ background: book.color }} />{book.title}</h3>
                {ns.map((n) => (
                  <button key={n.id} type="button" className="note-card note-card-main flat" onClick={() => onOpen(book, n.page, n.id)}>
                    <span className="note-meta">
                      {n.color && <span className="note-color" style={{ background: n.color }} />}p. {n.page} · {relativeTime(n.createdAt)}
                    </span>
                    {n.quote && <span className="note-quote">“{n.quote}”</span>}
                    {n.text && <span className="note-text">{n.text}</span>}
                    {n.tags.length > 0 && <span className="note-tags">{n.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</span>}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="all-notes-list">
          {!savedGroups.length && <p className="muted notes-empty">No bookmarks yet. Tap the bookmark icon while reading to save a page.</p>}
          {savedGroups.map(({ book, marks }) => (
            <section key={book.id} className="note-group">
              <h3 className="note-group-title"><span className="dot" style={{ background: book.color }} />{book.title}</h3>
              {marks.map((m) => (
                <div key={m.id} className="saved-row">
                  <button type="button" className="note-card note-card-main flat grow" onClick={() => onOpen(book, m.page)}>
                    <span className="note-text">Page {m.page}</span>
                    <span className="note-meta">Saved {relativeTime(m.createdAt)}</span>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove bookmark on page ${m.page}`} onClick={() => toggleBookmark(book.id, m.page)}>
                    <IconTrash size={18} />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
