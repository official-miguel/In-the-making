import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Note } from '../lib/db';
import { ensureLocalFile } from '../state/sync';
import { getPageParagraphs, loadDocument, renderPage, type PDFDocumentProxy } from '../lib/pdf';
import { spreadGeometry, viewportSize } from '../lib/layout';
import { HIGHLIGHT_COLORS, HIGHLIGHT_NAMES } from '../lib/colors';
import { addNote, toggleBookmark, toast, updateBook, updateNote, updateSettings, useStore, type Theme } from '../state/store';
import { Page } from './Page';
import { Spread } from './Spread';
import { SelectionToolbar, type SelectionInfo } from './SelectionToolbar';
import { NoteCard, NoteComposer, NotesPanel, NotesTabs, ExportPanel, noteCounts, sortNotes, type NotesTab } from './NotesPanel';
import { IconBook, IconBookmark, IconChevronLeft, IconChevronRight, IconSearch, IconText, IconX } from './Icons';

interface Props {
  book: Book;
  isPhone: boolean;
  initialPage?: number;
  initialNoteId?: string;
  onBack: () => void;
}

function useViewport() {
  const [vp, setVp] = useState(viewportSize);
  useEffect(() => {
    const on = () => setVp(viewportSize());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

export function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}

export function Reader({ book, isPhone, initialPage, initialNoteId, onBack }: Props) {
  const settings = useStore((s) => s.settings);
  const allNotes = useStore((s) => s.notes);
  const bookmarks = useStore((s) => s.bookmarks);
  const notes = useMemo(() => allNotes.filter((n) => n.bookId === book.id), [allNotes, book.id]);
  const vp = useViewport();
  const geo = spreadGeometry(vp.w, vp.h);
  const reduced = useReducedMotion();

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const count = book.pageCount;
  const [page, setPage] = useState(() => Math.min(Math.max(1, initialPage ?? book.lastPage ?? 1), count));
  const [notePage, setNotePage] = useState<number | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(initialNoteId ?? null);
  const [flashId, setFlashId] = useState<string | null>(initialNoteId ?? null);
  const [attach, setAttach] = useState<{ id: string; quote: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetColor, setSheetColor] = useState<string>(HIGHLIGHT_COLORS[0]);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mode = book.readingMode;
  const margin = isPhone ? 8 : 12;

  // ---------- load the PDF ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const blob = await ensureLocalFile(book);
      const d = await loadDocument(book.id, blob);
      if (alive) setDoc(d);
    })().catch((e) => {
      console.error(e);
      if (!alive) return;
      setLoadError(String(e?.message) === 'offline'
        ? 'This shared book is not on this device yet. Connect to the internet once to download it — after that it opens offline.'
        : 'This book could not be opened. The file may be damaged.');
    });
    return () => { alive = false; };
  }, [book.id]);

  // ---------- pages ----------
  const spreadIdx = Math.floor(page / 2);
  const pages = geo.phone ? [page] : [spreadIdx * 2, spreadIdx * 2 + 1];
  const visible = pages.filter((p) => p >= 1 && p <= count);
  const focusPage = notePage && visible.includes(notePage) ? notePage : geo.phone ? page : (visible[visible.length - 1] ?? 1);
  const canPrev = geo.phone ? page > 1 : spreadIdx > 0;
  const canNext = geo.phone ? page < count : spreadIdx * 2 + 1 < count;

  const go = useCallback((p: number) => {
    setPage(Math.min(Math.max(1, p), count));
    setNotePage(null);
  }, [count]);
  const next = useCallback(() => {
    if (!canNext) return;
    if (geo.phone) go(page + 1);
    else go((spreadIdx + 1) * 2 + 1); // go() clamps to the last page
  }, [canNext, geo.phone, go, page, spreadIdx]);
  const prev = useCallback(() => {
    if (!canPrev) return;
    if (geo.phone) go(page - 1);
    else go(Math.max(1, (spreadIdx - 1) * 2 + 1));
  }, [canPrev, geo.phone, go, page, spreadIdx]);

  // Save the reading position on every page change.
  useEffect(() => {
    const t = setTimeout(() => void updateBook(book.id, { lastPage: page, lastOpenedAt: Date.now() }), 250);
    return () => clearTimeout(t);
  }, [page, book.id]);

  // Render the visible pages plus 2 ahead (and 1 behind) into the cache.
  useEffect(() => {
    if (!doc || mode !== 'book') return;
    const ahead = geo.phone ? [page + 1, page + 2, page - 1] : [pages[1] + 1, pages[1] + 2, pages[0] - 1];
    const t = setTimeout(() => {
      for (const p of ahead) if (p >= 1 && p <= count) renderPage(book.id, doc, p, geo.pageW, geo.pageH, margin).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, mode, geo.pageW, geo.pageH, geo.phone]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); go(1); }
      else if (e.key === 'End') { e.preventDefault(); go(count); }
      else if (e.key === 'Escape' && !searchOpen) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
        else if (!sheetOpen) onBack();
        else setSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, go, count, onBack, searchOpen, sheetOpen]);

  // ---------- notes ----------
  const flash = (id: string) => {
    setFlashId(null);
    requestAnimationFrame(() => setFlashId(id));
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1800);
  };
  useEffect(() => { if (initialNoteId) flash(initialNoteId); }, [initialNoteId]);

  const selectNote = (n: Note) => {
    setActiveNoteId(n.id);
    if (!visible.includes(n.page)) go(n.page);
    setNotePage(n.page);
    flash(n.id);
  };

  const onHighlight = async (info: SelectionInfo, color: string) => {
    const n = await addNote({ bookId: book.id, page: info.page, quote: info.quote, rects: info.rects, color, text: '' });
    setActiveNoteId(n.id);
    setNotePage(info.page);
  };
  const onNoteFromSelection = async (info: SelectionInfo) => {
    const n = await addNote({ bookId: book.id, page: info.page, quote: info.quote, rects: info.rects, color: isPhone ? sheetColor : HIGHLIGHT_COLORS[0], text: '' });
    setActiveNoteId(n.id);
    setNotePage(info.page);
    setAttach({ id: n.id, quote: info.quote });
    if (isPhone) setSheetOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const onSubmitNote = async (text: string) => {
    if (attach) {
      await updateNote(attach.id, { text });
      setAttach(null);
    } else {
      const n = await addNote({ bookId: book.id, page: focusPage, text, color: undefined });
      setActiveNoteId(n.id);
    }
    toast('Note saved');
  };

  const isBookmarked = bookmarks.some((b) => b.bookId === book.id && b.page === focusPage);
  const onBookmark = async () => {
    const on = await toggleBookmark(book.id, focusPage);
    toast(on ? `Bookmarked p. ${focusPage}` : 'Bookmark removed');
  };
  const setMode = (m: 'book' | 'text') => void updateBook(book.id, { readingMode: m });
  const setPaper = (t: Theme) => void updateSettings({ paperTheme: t });

  const pageLabel = visible.length === 2 ? `Pages ${visible[0]}–${visible[1]} of ${count}` : `Page ${visible[0] ?? page} of ${count}`;
  const pct = count > 1 ? ((page - 1) / (count - 1)) * 100 : 100;

  const renderOne = (n: number, side: 'left' | 'right' | 'single') => (
    <Page key={n} book={book} doc={doc} pageNum={n} w={geo.pageW} h={geo.pageH} mode={mode} margin={margin}
      notes={notes.filter((x) => x.page === n)} flashId={flashId} side={side}
      onMarker={(note) => { selectNote(note); if (isPhone) setSheetOpen(true); }}
      onSwitchToBook={() => setMode('book')} />
  );

  const modeButton = (
    <button type="button" className="icon-btn outline" onClick={() => setMode(mode === 'book' ? 'text' : 'book')}
      aria-label={mode === 'book' ? 'Switch to text mode' : 'Switch to book mode'} title={mode === 'book' ? 'Text mode' : 'Book mode'}>
      {mode === 'book' ? <IconText /> : <IconBook />}
    </button>
  );

  const themeSwitch = (
    <div className="segmented" role="radiogroup" aria-label="Page colour">
      {(['day', 'sepia', 'night'] as Theme[]).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={settings.paperTheme === t} onClick={() => setPaper(t)}>
          {t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );

  const slider = (
    <input type="range" className="slider" min={1} max={count} value={page} aria-label="Reading progress"
      aria-valuetext={pageLabel} style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => go(Number(e.target.value))} />
  );

  return (
    <div className={`reader paper-${settings.paperTheme}` + (geo.phone ? ' phone' : '')} ref={setRootEl}>
      {geo.phone ? (
        <header className="reader-topbar phone">
          <button type="button" className="icon-btn" aria-label="Back to shelf" onClick={onBack}><IconChevronLeft size={22} /></button>
          <h1 className="reader-title">{book.title}</h1>
          <button type="button" className={'icon-btn' + (isBookmarked ? ' on' : '')} aria-pressed={isBookmarked}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'} onClick={onBookmark}>
            <IconBookmark filled={isBookmarked} />
          </button>
        </header>
      ) : (
        <header className="reader-topbar">
          <button type="button" className="btn btn-outline btn-back" onClick={onBack}><IconChevronLeft size={18} /> Shelf</button>
          <h1 className="reader-title">{book.title}</h1>
          <div className="reader-tools">
            {modeButton}
            <button type="button" className="icon-btn outline" aria-label="Search in book" aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
              <IconSearch />
            </button>
            <button type="button" className={'icon-btn outline' + (isBookmarked ? ' on' : '')} aria-pressed={isBookmarked}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'} onClick={onBookmark}>
              <IconBookmark filled={isBookmarked} />
            </button>
            {themeSwitch}
          </div>
        </header>
      )}

      {searchOpen && doc && <BookSearch book={book} doc={doc} onClose={() => setSearchOpen(false)} onJump={(p) => { go(p); if (isPhone) setSearchOpen(false); }} phone={geo.phone} />}

      <div className="reader-body">
        <div className="reader-stage" style={geo.phone ? undefined : { width: geo.areaW }}>
          <div style={geo.phone ? { position: 'absolute', left: 0, top: 0 } : { position: 'absolute', left: geo.x, top: geo.y - 64 }}>
            {loadError ? (
              <div className="page load-error" style={{ width: geo.pageW * (geo.phone ? 1 : 2), height: geo.pageH }}>
                <p>{loadError}</p>
                <button type="button" className="btn btn-accent" onClick={onBack}>Back to shelf</button>
              </div>
            ) : (
              <Spread pages={pages} pageW={geo.pageW} pageH={geo.pageH} renderPage={renderOne}
                animate={settings.pageAnimation} reduced={reduced}
                canPrev={canPrev} canNext={canNext} onPrev={prev} onNext={next} />
            )}
            {!geo.phone && (
              <div className="reader-controls" style={{ width: geo.pageW * 2 }}>
                <button type="button" className="icon-btn outline" aria-label="Previous page" disabled={!canPrev} onClick={prev}><IconChevronLeft /></button>
                {slider}
                <span className="page-label" aria-live="polite">{pageLabel}</span>
                <button type="button" className="icon-btn outline" aria-label="Next page" disabled={!canNext} onClick={next}><IconChevronRight /></button>
              </div>
            )}
          </div>
        </div>

        {!geo.phone && (
          <NotesPanel book={book} notes={notes} visiblePages={visible} focusPage={focusPage} activeNoteId={activeNoteId}
            attachQuote={attach?.quote} onSelect={selectNote} onSubmit={onSubmitNote} onCancelAttach={() => setAttach(null)} inputRef={inputRef} />
        )}
      </div>

      {geo.phone && (
        <PhoneSheet
          open={sheetOpen} setOpen={setSheetOpen} book={book} notes={notes} page={page} count={count}
          activeNoteId={activeNoteId} onSelect={selectNote} color={sheetColor} setColor={setSheetColor}
          attachQuote={attach?.quote} onSubmit={onSubmitNote} onCancelAttach={() => setAttach(null)} inputRef={inputRef}
          slider={slider} prev={prev} next={next} canPrev={canPrev} canNext={canNext}
          extras={<div className="sheet-tools">{modeButton}
            <button type="button" className="icon-btn outline" aria-label="Search in book" onClick={() => { setSearchOpen(true); setSheetOpen(false); }}><IconSearch /></button>
            {themeSwitch}</div>}
        />
      )}

      <SelectionToolbar root={rootEl} onHighlight={onHighlight} onNote={onNoteFromSelection} />
    </div>
  );
}

function PhoneSheet(props: {
  open: boolean; setOpen: (o: boolean) => void; book: Book; notes: Note[]; page: number; count: number;
  activeNoteId: string | null; onSelect: (n: Note) => void; color: string; setColor: (c: string) => void;
  attachQuote?: string; onSubmit: (t: string) => void; onCancelAttach: () => void; inputRef: React.RefObject<HTMLInputElement>;
  slider: React.ReactNode; prev: () => void; next: () => void; canPrev: boolean; canNext: boolean; extras: React.ReactNode;
}) {
  const { open, setOpen, book, notes, page } = props;
  const [tab, setTab] = useState<NotesTab>('page');
  const counts = noteCounts(notes);
  const list = sortNotes(tab === 'page' ? notes.filter((n) => n.page === page) : notes);
  return (
    <section className={'sheet' + (open ? ' open' : '')} aria-label="Notes and page controls">
      <button type="button" className="sheet-handle" aria-expanded={open} onClick={() => setOpen(!open)}
        aria-label={open ? 'Hide notes' : `Show notes (${counts.notes} notes, ${counts.highlights} highlights)`}>
        <span />
      </button>
      {open && (
        <div className="sheet-expanded">
          {props.extras}
          <NotesTabs tab={tab} setTab={setTab} />
          <div className="sheet-list">
            {tab === 'export' ? <ExportPanel book={book} notes={notes} /> : list.length
              ? list.map((n) => <NoteCard key={n.id} note={n} active={n.id === props.activeNoteId} onSelect={props.onSelect} />)
              : <p className="muted small notes-empty">{tab === 'page' ? 'No notes on this page yet.' : 'No notes yet.'} Select text to highlight it.</p>}
          </div>
        </div>
      )}
      <div className="sheet-colors">
        <div className="row gap12" role="radiogroup" aria-label="Highlight colour">
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={props.color === c} aria-label={`${HIGHLIGHT_NAMES[c]} highlight`}
              className="hl-dot lg" style={{ background: c }} onClick={() => props.setColor(c)} />
          ))}
        </div>
        <span className="muted small">p. {page}</span>
      </div>
      <NoteComposer page={page} attachedQuote={props.attachQuote} onSubmit={props.onSubmit} onCancelAttach={props.onCancelAttach} inputRef={props.inputRef} />
      <div className="sheet-nav">
        <button type="button" className="icon-btn outline" aria-label="Previous page" disabled={!props.canPrev} onClick={props.prev}><IconChevronLeft /></button>
        {props.slider}
        <button type="button" className="icon-btn outline" aria-label="Next page" disabled={!props.canNext} onClick={props.next}><IconChevronRight /></button>
      </div>
    </section>
  );
}

function BookSearch({ book, doc, onJump, onClose, phone }: { book: Book; doc: PDFDocumentProxy; onJump: (p: number) => void; onClose: () => void; phone: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ page: number; snippet: string }[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const token = useRef(0);

  const run = async (query: string) => {
    const my = ++token.current;
    const needle = query.trim().toLowerCase();
    setResults([]);
    if (needle.length < 2) { setProgress(null); return; }
    const found: { page: number; snippet: string }[] = [];
    for (let p = 1; p <= book.pageCount; p++) {
      if (token.current !== my) return;
      if (p % 10 === 0) setProgress(p);
      const text = (await getPageParagraphs(book.id, doc, p).catch(() => [])).join(' ');
      const i = text.toLowerCase().indexOf(needle);
      if (i >= 0) {
        found.push({ page: p, snippet: (i > 40 ? '…' : '') + text.slice(Math.max(0, i - 40), i + needle.length + 60) + '…' });
        setResults([...found]);
        if (found.length >= 60) break;
      }
    }
    if (token.current === my) setProgress(null);
  };

  return (
    <div className={'book-search' + (phone ? ' phone' : '')} role="search">
      <form className="row gap8" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
        <input className="input" autoFocus value={q} placeholder="Find in this book" aria-label="Find in this book"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <button type="submit" className="btn btn-accent">Find</button>
        <button type="button" className="icon-btn" aria-label="Close search" onClick={() => { token.current++; onClose(); }}><IconX /></button>
      </form>
      {book.hasText === false && <p className="muted small">This PDF is scanned, so it has no searchable text.</p>}
      {progress !== null && <p className="muted small" aria-live="polite">Searching page {progress} of {book.pageCount}…</p>}
      {progress === null && q.trim().length >= 2 && results.length === 0 && token.current > 0 && <p className="muted small">No matches.</p>}
      <div className="book-search-results">
        {results.map((r) => (
          <button key={r.page} type="button" className="search-hit" onClick={() => onJump(r.page)}>
            <span className="search-hit-body">
              <span className="search-hit-title">p. {r.page}</span>
              <span className="search-hit-text">{r.snippet}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
