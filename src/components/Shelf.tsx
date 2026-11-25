import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book, Collection } from '../lib/db';
import {
  addCollection, addFiles, deleteCollection, moveBook, renameCollection, useStore,
} from '../state/store';
import { BookSpine, PHONE_SPINE_SCALE, SpineFace, spineSize } from './BookSpine';
import { BookCard } from './BookCard';
import { InstallBanner, InstallButton } from './Install';
import { IconLibrary, IconNote, IconPlus, IconSearch, IconSettings, IconTrash, IconX } from './Icons';

interface Props {
  isPhone: boolean;
  hiddenBookId: string | null;
  onOpen: (book: Book, page?: number, noteId?: string) => void;
  onShowNotes: () => void;
  onShowSettings: () => void;
  pickFiles: () => void;
}

const GAP = 4;

interface Drag { id: string; x: number; y: number; ox: number; oy: number }
interface Drop { collectionId: string; beforeId: string | null }

export function Shelf({ isPhone, hiddenBookId, onOpen, onShowNotes, onShowSettings, pickFiles }: Props) {
  const books = useStore((s) => s.books);
  const collections = useStore((s) => s.collections);
  const notes = useStore((s) => s.notes);
  const ready = useStore((s) => s.ready);

  const [query, setQuery] = useState('');
  const [phoneSearch, setPhoneSearch] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [width, setWidth] = useState(1000);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number>();

  const k = isPhone ? PHONE_SPINE_SCALE : 1;
  const inset = isPhone ? 8 : 20;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const notesByBook = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) m.set(n.bookId, (m.get(n.bookId) || 0) + 1);
    return m;
  }, [notes]);

  // ---------- search ----------
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const ids = new Set<string>();
    for (const b of books) if (b.title.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q)) ids.add(b.id);
    const noteHits = notes.filter((n) => n.text.toLowerCase().includes(q) || n.quote?.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)));
    for (const n of noteHits) ids.add(n.bookId);
    return { ids, noteHits: noteHits.slice(0, 6) };
  }, [q, books, notes]);

  // ---------- packing books onto boards ----------
  const shelves = useMemo(() => {
    const capacity = Math.max(120, width - inset * 2);
    const out: { col: Collection; boards: Book[][] }[] = [];
    for (const col of collections) {
      const list = books.filter((b) => b.collectionId === col.id);
      const boards: Book[][] = [[]];
      let used = 0;
      for (const b of list) {
        const w = spineSize(b, k).w + GAP;
        if (used + w > capacity && boards[boards.length - 1].length) {
          boards.push([]);
          used = 0;
        }
        boards[boards.length - 1].push(b);
        used += w;
      }
      out.push({ col, boards });
    }
    // Always at least 2 boards so even an empty library looks like a shelf.
    const total = out.reduce((s, x) => s + x.boards.length, 0);
    if (out.length && total < 2) for (let i = total; i < 2; i++) out[out.length - 1].boards.push([]);
    return out;
  }, [books, collections, width, k, inset]);

  const flatOrder = useMemo(() => shelves.flatMap((s) => s.boards.flat().map((b) => b.id)), [shelves]);
  const continueBook = useMemo(
    () => [...books].filter((b) => b.lastOpenedAt > 0).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0],
    [books],
  );

  // ---------- hover / focus card ----------
  const showCard = (id: string) => { clearTimeout(hoverTimer.current); setActiveId(id); };
  const hideCardSoon = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setActiveId(null), 160);
  };

  useEffect(() => {
    if (!activeId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.book-slot')) setActiveId(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [activeId]);

  const focusBook = (id: string) => {
    setFocusId(id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.spine[data-book-id="${id}"]`)?.focus());
  };

  const onSpineKey = (e: React.KeyboardEvent, book: Book) => {
    const i = flatOrder.indexOf(book.id);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = flatOrder[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) focusBook(next);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const me = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = me.left + me.width / 2;
      const all = Array.from(document.querySelectorAll<HTMLElement>('.shelf .spine'));
      const rows = all
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => (e.key === 'ArrowUp' ? r.bottom < me.top - 20 : r.top > me.bottom + 20));
      if (!rows.length) return;
      const targetBottom = e.key === 'ArrowUp' ? Math.max(...rows.map((x) => x.r.bottom)) : Math.min(...rows.map((x) => x.r.bottom));
      const sameRow = rows.filter((x) => Math.abs(x.r.bottom - targetBottom) < 4);
      sameRow.sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - cx) - Math.abs(b.r.left + b.r.width / 2 - cx));
      const id = sameRow[0]?.el.dataset.bookId;
      if (id) focusBook(id);
    } else if (e.key === 'Escape') {
      setActiveId(null);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (flatOrder[0]) focusBook(flatOrder[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (flatOrder.length) focusBook(flatOrder[flatOrder.length - 1]);
    }
  };

  // ---------- drag to reorder (mouse drag, long-press on touch) ----------
  const pending = useRef<{ id: string; x: number; y: number; touch: boolean; timer?: number; el: HTMLElement } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const suppressClick = useRef(false);

  const computeDrop = useCallback((x: number, y: number, dragId: string): Drop | null => {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    const spine = els.find((el) => el.classList?.contains('spine') && el.dataset.bookId && el.dataset.bookId !== dragId);
    if (spine) {
      const id = spine.dataset.bookId!;
      const b = books.find((x) => x.id === id);
      if (!b) return null;
      const r = spine.getBoundingClientRect();
      if (x < r.left + r.width / 2) return { collectionId: b.collectionId, beforeId: id };
      const same = books.filter((x) => x.collectionId === b.collectionId && x.id !== dragId);
      const idx = same.findIndex((x) => x.id === id);
      return { collectionId: b.collectionId, beforeId: same[idx + 1]?.id ?? null };
    }
    const row = els.find((el) => el.dataset?.collectionId);
    if (row) return { collectionId: row.dataset.collectionId!, beforeId: null };
    return null;
  }, [books]);

  const beginDrag = useCallback((x: number, y: number) => {
    const p = pending.current;
    if (!p) return;
    const r = p.el.getBoundingClientRect();
    const d = { id: p.id, x, y, ox: x - r.left, oy: y - r.top };
    dragRef.current = d;
    setDrag(d);
    setActiveId(null);
    if (p.touch) navigator.vibrate?.(12);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (!dragRef.current) {
        if (!p.touch && dist > 6) beginDrag(e.clientX, e.clientY);
        else if (p.touch && dist > 10) { clearTimeout(p.timer); pending.current = null; }
        return;
      }
      const d = { ...dragRef.current, x: e.clientX, y: e.clientY };
      dragRef.current = d;
      setDrag(d);
      const dr = computeDrop(e.clientX, e.clientY, d.id);
      dropRef.current = dr;
      setDrop(dr);
    };
    const up = () => {
      const p = pending.current;
      if (p?.timer) clearTimeout(p.timer);
      pending.current = null;
      const d = dragRef.current;
      if (d) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 50);
        const dr = dropRef.current;
        if (dr) void moveBook(d.id, dr.collectionId, dr.beforeId);
      }
      dragRef.current = null;
      dropRef.current = null;
      setDrag(null);
      setDrop(null);
    };
    // Stops the page from scrolling while a long-pressed book is being dragged.
    const touchMove = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', touchMove);
    };
  }, [beginDrag, computeDrop]);

  const lastPointer = useRef<string>('mouse');
  const onSpinePointerDown = (e: React.PointerEvent<HTMLButtonElement>, book: Book) => {
    lastPointer.current = e.pointerType;
    if (e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    pending.current = { id: book.id, x: e.clientX, y: e.clientY, touch, el: e.currentTarget };
    if (touch) pending.current.timer = window.setTimeout(() => beginDrag(e.clientX, e.clientY), 420);
  };

  const onSpineClick = (book: Book) => {
    if (suppressClick.current) return;
    setFocusId(book.id);
    if (lastPointer.current !== 'mouse' && activeId !== book.id) {
      showCard(book.id); // first tap shows the card and full title
      return;
    }
    onOpen(book);
  };

  // ---------- dropping files ----------
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setFileOver(true);
  };
  const onFileDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setFileOver(false);
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-collection-id]');
    addFiles(e.dataTransfer.files, row?.dataset.collectionId);
  };

  const dragBook = drag ? books.find((b) => b.id === drag.id) : null;
  const firstEmpty = books.length === 0;
  const rovingId = focusId && flatOrder.includes(focusId) ? focusId : flatOrder[0];

  return (
    <div
      className={'shelf-screen' + (isPhone ? ' phone' : '')}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false); }}
      onDrop={onFileDrop}
    >
      {isPhone ? (
        <header className="phone-header">
          <h1 className="brand-title">My Library</h1>
          <div className="row gap8">
            <button type="button" className="icon-btn outline" aria-label="Settings" onClick={onShowSettings}><IconSettings /></button>
            <button type="button" className="icon-btn outline" aria-label={phoneSearch ? 'Close search' : 'Search books or notes'} aria-expanded={phoneSearch}
              onClick={() => { setPhoneSearch((v) => !v); setQuery(''); }}>
              {phoneSearch ? <IconX /> : <IconSearch />}
            </button>
          </div>
        </header>
      ) : (
        <header className="topbar">
          <div className="brand">
            <IconLibrary size={26} className="brand-icon" />
            <h1 className="brand-title">My Library</h1>
          </div>
          <div className="topbar-right">
            <button type="button" className="icon-btn" aria-label="All notes" title="All notes" onClick={onShowNotes}><IconNote /></button>
            <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={onShowSettings}><IconSettings /></button>
            <SearchBox query={query} setQuery={setQuery} />
            <InstallButton />
            <button type="button" className="btn btn-accent btn-add" onClick={pickFiles}><IconPlus size={18} /> Add PDF</button>
          </div>
        </header>
      )}

      {isPhone && <InstallBanner />}

      {isPhone && phoneSearch && (
        <div className="phone-search"><SearchBox query={query} setQuery={setQuery} autoFocus /></div>
      )}

      {matches && matches.noteHits.length > 0 && (
        <div className={'search-results' + (isPhone ? ' phone' : '')} role="region" aria-label="Matching notes">
          {matches.noteHits.map((n) => {
            const b = books.find((x) => x.id === n.bookId);
            if (!b) return null;
            return (
              <button key={n.id} type="button" className="search-hit" onClick={() => { setQuery(''); onOpen(b, n.page, n.id); }}>
                <span className="dot" style={{ background: b.color }} />
                <span className="search-hit-body">
                  <span className="search-hit-title">{b.title} · p. {n.page}</span>
                  <span className="search-hit-text">{n.text || n.quote}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isPhone && continueBook && !q && (
        <div className="continue-card">
          <span className="continue-cover" style={{ background: continueBook.color }} aria-hidden="true" />
          <div className="continue-body">
            <span className="continue-label">Continue reading</span>
            <span className="continue-title">{continueBook.title}</span>
            <span className="continue-meta">Page {continueBook.lastPage} of {continueBook.pageCount}</span>
          </div>
          <button type="button" className="btn btn-accent" onClick={() => onOpen(continueBook)} aria-label={`Open ${continueBook.title}`}>Open</button>
        </div>
      )}

      <main className="shelf" ref={wrapRef} aria-label="Bookshelf">
        {shelves.map(({ col, boards }, ci) => (
          <section key={col.id} className="collection" aria-label={col.name}>
            {(!isPhone || collections.length > 1) && (
              <div className="collection-head">
                {editingRow === col.id ? (
                  <form className="row gap8" onSubmit={(e) => { e.preventDefault(); setEditingRow(null); }}>
                    <input className="input sm row-name-input" defaultValue={col.name} autoFocus aria-label="Row name"
                      onBlur={(e) => { void renameCollection(col.id, e.target.value); setEditingRow(null); }} />
                    {collections.length > 1 && (
                      <button type="button" className="icon-btn sm" aria-label={`Remove row ${col.name}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { void deleteCollection(col.id); setEditingRow(null); }}>
                        <IconTrash size={16} />
                      </button>
                    )}
                  </form>
                ) : (
                  <button type="button" className="collection-name" onClick={() => setEditingRow(col.id)} title="Rename row">
                    {col.name}
                  </button>
                )}
                {ci === 0 && !isPhone && <span className="collection-hint">Drag a PDF anywhere on the shelf to add it</span>}
              </div>
            )}
            {boards.map((row, ri) => {
              const isLastBoard = ri === boards.length - 1;
              return (
                <div key={ri} className="board-row" data-collection-id={col.id} style={{ height: isPhone ? 140 : 206 }}>
                  <div className="board-books" style={{ paddingLeft: inset, gap: GAP }}>
                    {row.map((b) => (
                      <Fragment key={b.id}>
                        {drop && drop.beforeId === b.id && <span className="drop-marker" />}
                        <div className="book-slot" data-active={activeId === b.id || undefined}>
                          <BookSpine
                            book={b} k={k}
                            active={activeId === b.id}
                            dimmed={!!matches && !matches.ids.has(b.id)}
                            hidden={hiddenBookId === b.id}
                            dragging={drag?.id === b.id}
                            notesCount={notesByBook.get(b.id) || 0}
                            tabIndex={rovingId === b.id ? 0 : -1}
                            onPointerDown={(e) => onSpinePointerDown(e, b)}
                            onClick={() => onSpineClick(b)}
                            onMouseEnter={() => !drag && showCard(b.id)}
                            onMouseLeave={hideCardSoon}
                            onFocus={() => { setFocusId(b.id); showCard(b.id); }}
                            onKeyDown={(e) => onSpineKey(e, b)}
                            onContextMenu={(e) => e.preventDefault()}
                          />
                          {activeId === b.id && !drag && (
                            <BookCard
                              book={b}
                              notesCount={notesByBook.get(b.id) || 0}
                              onOpen={() => { setActiveId(null); onOpen(b); }}
                              onClose={() => { setActiveId(null); focusBook(b.id); }}
                              onPointerEnter={() => showCard(b.id)}
                              onPointerLeave={hideCardSoon}
                            />
                          )}
                        </div>
                      </Fragment>
                    ))}
                    {drop && drop.collectionId === col.id && drop.beforeId === null && isLastBoard && <span className="drop-marker" />}
                    {row.length === 0 && (ci === 0 && ri === 0 ? firstEmpty : !books.some((b) => b.collectionId === col.id) && ri === 0) && (
                      <button type="button" className="drop-hint" onClick={pickFiles}>
                        <span className="drop-hint-title">{ready ? 'Drop a PDF here' : 'Loading your shelf…'}</span>
                        <span className="drop-hint-sub">{isPhone ? 'or tap + to choose files' : 'or click to choose files'}</span>
                      </button>
                    )}
                  </div>
                  <div className="board" aria-hidden="true" />
                </div>
              );
            })}
          </section>
        ))}
        <div className="shelf-footer">
          <button type="button" className="btn btn-ghost" onClick={async () => { const c = await addCollection('New row'); setEditingRow(c.id); }}>
            <IconPlus size={16} /> New row
          </button>
        </div>
      </main>

      {isPhone && (
        <button type="button" className="fab" aria-label="Add PDF" onClick={pickFiles}><IconPlus size={26} /></button>
      )}

      {fileOver && (
        <div className="file-over" aria-hidden="true">
          <div className="file-over-box">Drop PDFs to add them to your shelf</div>
        </div>
      )}

      {drag && dragBook && (
        <div className="drag-ghost" style={{ transform: `translate(${drag.x - drag.ox}px, ${drag.y - drag.oy}px) rotate(-3deg)` }} aria-hidden="true">
          <SpineFace book={dragBook} {...spineSize(dragBook, k)} />
        </div>
      )}
    </div>
  );
}

function SearchBox({ query, setQuery, autoFocus }: { query: string; setQuery: (s: string) => void; autoFocus?: boolean }) {
  return (
    <div className="search-field">
      <IconSearch size={18} className="search-icon" />
      <input
        type="search"
        className="search-input"
        placeholder="Search books or notes"
        aria-label="Search books or notes"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
    </div>
  );
}
