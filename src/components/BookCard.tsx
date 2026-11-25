import { useLayoutEffect, useRef, useState } from 'react';
import type { Book } from '../lib/db';
import { BOOK_COLORS } from '../lib/colors';
import { canRemoveForEveryone, deleteBook, moveBook, updateBook, useStore } from '../state/store';
import { percentRead } from './BookSpine';
import { IconChevronLeft, IconMore } from './Icons';

interface Props {
  book: Book;
  notesCount: number;
  onOpen: () => void;
  onClose: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/** The small card that appears above a lifted book. */
export function BookCard({ book, notesCount, onOpen, onClose, onPointerEnter, onPointerLeave }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(book.title);
  const collections = useStore((s) => s.collections);
  const pct = percentRead(book);
  const session = useStore((s) => s.session);
  const mine = canRemoveForEveryone(book);
  void session; // re-render when sign-in changes
  const sharedNotMine = !!book.remoteId && !mine;

  // Keep the card inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--nudge', '0px');
    const r = el.getBoundingClientRect();
    const pad = 8;
    let nudge = 0;
    if (r.left < pad) nudge = pad - r.left;
    else if (r.right > window.innerWidth - pad) nudge = window.innerWidth - pad - r.right;
    el.style.setProperty('--nudge', `${nudge}px`);
  }, [menu]);

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== book.title) void updateBook(book.id, { title: t });
  };

  return (
    <div
      ref={ref}
      className="book-card"
      role="dialog"
      aria-label={book.title}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      {!menu ? (
        <>
          <div className="book-card-head">
            <h3 className="book-card-title">{book.title}</h3>
            <button type="button" className="icon-btn sm" aria-label={`More options for ${book.title}`} onClick={() => setMenu(true)}>
              <IconMore size={18} />
            </button>
          </div>
          <p className="book-card-meta">
            {book.pageCount} {book.pageCount === 1 ? 'page' : 'pages'} · {pct}% read · {notesCount} {notesCount === 1 ? 'note' : 'notes'}
          </p>
          <p className="book-card-cloud">{cloudLabel(book, mine)}</p>
          <button type="button" className="btn btn-accent btn-block" onClick={onOpen}>Open book</button>
        </>
      ) : (
        <div className="book-menu">
          <button type="button" className="link-btn" onClick={() => { saveTitle(); setMenu(false); }}>
            <IconChevronLeft size={16} /> Back
          </button>
          <label className="field-label" htmlFor={`t-${book.id}`}>Title</label>
          <input id={`t-${book.id}`} className="input sm" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle} onKeyDown={(e) => e.key === 'Enter' && saveTitle()} />
          <span className="field-label">Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Spine colour">
            {BOOK_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={book.color === c} aria-label={`Colour ${c}`}
                className="swatch" style={{ background: c }} onClick={() => updateBook(book.id, { color: c })} />
            ))}
          </div>
          {collections.length > 1 && (
            <>
              <label className="field-label" htmlFor={`c-${book.id}`}>Row</label>
              <select id={`c-${book.id}`} className="input sm" value={book.collectionId}
                onChange={(e) => moveBook(book.id, e.target.value, null)}>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>
          )}
          <button type="button" className={'btn btn-danger btn-block' + (confirmDelete ? ' confirm' : '')}
            onClick={() => { if (confirmDelete) { void deleteBook(book.id); onClose(); } else setConfirmDelete(true); }}>
            {confirmDelete
              ? (mine ? 'Tap again to remove it for everyone' : 'Tap again to remove book and notes')
              : mine ? 'Remove from shared library' : sharedNotMine ? 'Hide on this device' : 'Remove from shelf'}
          </button>
        </div>
      )}
    </div>
  );
}

function cloudLabel(book: Book, mine: boolean) {
  if (!book.remoteId) return book.cloud === 'local' || !book.cloud ? 'Only on this device' : '';
  const where = book.cloud === 'remote' ? 'Shared · downloads when opened' : 'Shared · saved on this device';
  return mine ? `${where} · added by you` : where;
}
