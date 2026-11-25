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
import { IconBook, IconBookmark, IconChevronDown, IconMinus, IconNote, IconPlus, IconChevronLeft, IconChevronRight, IconSearch, IconText, IconX } from './Icons';

export const MIN_ZOOM = 1;
const BOOK_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const TEXT_STEPS = [1, 1.15, 1.3, 1.5, 1.75, 2];
/** Text mode reflows, so it needs less magnification than a fixed PDF page. */
function clampZoom(z: number, max: number) { return Math.min(max, Math.max(MIN_ZOOM, z || 1)); }
function stepZoom(z: number, dir: 1 | -1, mode: 'book' | 'text', max: number) {
  const steps = [...(mode === 'text' ? TEXT_STEPS : BOOK_STEPS).filter((x) => x <= max + 0.001)];
  if (steps[steps.length - 1] < max - 0.001) steps.push(max);
  if (dir > 0) return steps.find((x) => x > z + 0.01) ?? steps[steps.length - 1];
  return [...steps].reverse().find((x) => x < z - 0.01) ?? steps[0];
}

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
  const panelHidden = !!settings.notesPanelHidden;
  const geo = spreadGeometry(vp.w, vp.h, { sheetHidden: panelHidden });
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
  /** Phone: hide the notes panel (page fills the screen) or bring it back. Remembered between books. */
  const setPanelHidden = useCallback((hidden: boolean) => {
    if (hidden) setSheetOpen(false);
    void updateSettings({ notesPanelHidden: hidden });
  }, []);
  const [sheetColor, setSheetColor] = useState<string>(HIGHLIGHT_COLORS[0]);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mode = book.readingMode;
  const margin = isPhone ? 8 : 12;

  // ---------- zoom ----------
  // On PC, book-mode zoom shows ONE page that fills the reading area's width (fit width) and scrolls down,
  // so text never runs off the side. Zoom stops at the widest page that still fits.
  const widthCap = Math.max(1, Math.floor(((geo.areaW - 64) / geo.pageW) * 20) / 20);
  const zoomMax = geo.phone ? (mode === 'text' ? 2 : 3) : Math.min(mode === 'text' ? 2 : 3, widthCap);
  const zoom = clampZoom(settings.zoom ?? 1, zoomMax);
  // PC zoom (book and text mode): one wide page instead of the two-page spread.
  const zoomView = !geo.phone && zoom > 1;
  const setZoom = useCallback((z: number) => void updateSettings({ zoom: clampZoom(Math.round(z * 100) / 100, zoomMax) }), [zoomMax]);
  const zoomIn = useCallback(() => setZoom(stepZoom(zoom, 1, mode, zoomMax)), [zoom, setZoom, mode, zoomMax]);
  const zoomOut = useCallback(() => setZoom(stepZoom(zoom, -1, mode, zoomMax)), [zoom, setZoom, mode, zoomMax]);
  const zoomReset = useCallback(() => setZoom(1), [setZoom]);
  const stageRef = useRef<HTMLDivElement>(null);
  const spreadWrapRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd + mouse wheel (and trackpad pinch, which browsers report the same way) zooms the page.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      setZoom(stepZoom(zoom, acc < 0 ? 1 : -1, mode, zoomMax));
      acc = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, setZoom, mode, zoomMax]);

  // Two-finger pinch on touch screens: live preview with a CSS scale, then re-render sharp at the new zoom.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let ratio = 1;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const preview = (r: number) => {
      const w = spreadWrapRef.current;
      if (w) w.style.transform = r === 1 ? '' : `scale(${r})`;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { startDist = dist(); ratio = 1; }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && startDist > 0) {
        ratio = Math.max(MIN_ZOOM / zoom, Math.min(zoomMax / zoom, dist() / startDist));
        preview(ratio);
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (startDist > 0 && pts.size < 2) {
        startDist = 0;
        preview(1);
        if (Math.abs(ratio - 1) > 0.08) setZoom(Math.round(zoom * ratio * 4) / 4); // snap to 25% steps
      }
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [zoom, setZoom, zoomMax]);

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
  const single = geo.phone || zoomView;
  /** Size of one page frame: the normal book page, or one wide page in the PC zoom view. */
  const frameW = zoomView ? Math.round(geo.pageW * zoom) : geo.pageW;
  const frameH = geo.pageH;
  const pages = single ? [page] : [spreadIdx * 2, spreadIdx * 2 + 1];
  const visible = pages.filter((p) => p >= 1 && p <= count);
  const focusPage = notePage && visible.includes(notePage) ? notePage : geo.phone ? page : (visible[visible.length - 1] ?? 1);
  const canPrev = single ? page > 1 : spreadIdx > 0;
  const canNext = single ? page < count : spreadIdx * 2 + 1 < count;

  const go = useCallback((p: number) => {
    setPage(Math.min(Math.max(1, p), count));
    setNotePage(null);
  }, [count]);
  const next = useCallback(() => {
    if (!canNext) return;
    if (single) go(page + 1);
    else go((spreadIdx + 1) * 2 + 1); // go() clamps to the last page
  }, [canNext, geo.phone, go, page, spreadIdx]);
  const prev = useCallback(() => {
    if (!canPrev) return;
    if (single) go(page - 1);
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
    const ahead = single ? [page + 1, page + 2, page - 1] : [pages[1] + 1, pages[1] + 2, pages[0] - 1];
    const t = setTimeout(() => {
      const W = zoomView ? frameW : Math.round(geo.pageW * zoom), H = zoomView ? frameH : Math.round(geo.pageH * zoom);
      const M = zoomView ? margin : Math.round(margin * zoom);
      for (const p of ahead) if (p >= 1 && p <= count) renderPage(book.id, doc, p, W, H, M, zoomView).catch(() => {});
    }, 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page, mode, geo.pageW, geo.pageH, geo.phone, zoom, zoomView]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); go(1); }
      else if (e.key === 'End') { e.preventDefault(); go(count); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); zoomReset(); }
      else if (e.key === 'Escape' && !searchOpen) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
        else if (!sheetOpen) onBack();
        else setSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, go, count, onBack, searchOpen, sheetOpen, zoomIn, zoomOut, zoomReset]);

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
    if (isPhone) { setSheetOpen(false); setPanelHidden(false); } // the note box must be visible
    setTimeout(() => inputRef.current?.focus(), 120);
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
    <Page key={n} book={book} doc={doc} pageNum={n} w={frameW} h={frameH} mode={mode} margin={margin}
      zoom={mode === 'text' ? zoom : zoomView ? 1 : zoom} fitWidth={zoomView && mode === 'book'}
      notes={notes.filter((x) => x.page === n)} flashId={flashId} side={side}
      onMarker={(note) => { selectNote(note); if (isPhone) { setPanelHidden(false); setSheetOpen(true); } }}
      onSwitchToBook={() => setMode('book')} />
  );

  const zoomControl = (
    <div className="zoom-control" role="group" aria-label="Zoom">
      <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= MIN_ZOOM} onClick={zoomOut}>
        <IconMinus size={18} />
      </button>
      <button type="button" className="zoom-value" onClick={zoomReset} title="Reset zoom (0)"
        aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to 100 percent`}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= zoomMax - 0.001} onClick={zoomIn}>
        <IconPlus size={18} />
      </button>
    </div>
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
    <div className={`reader paper-${settings.paperTheme}` + (geo.phone ? ' phone' : '') + (geo.phone && panelHidden ? ' panel-hidden' : '')} ref={setRootEl}>
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
            {zoomControl}
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
        <div className="reader-stage" ref={stageRef} style={geo.phone ? undefined : { width: geo.areaW }}>
          <div style={geo.phone ? { position: 'absolute', left: 0, top: 0 } : { position: 'absolute', left: zoomView ? Math.round((geo.areaW - frameW) / 2) : geo.x, top: geo.y - 64 }}>
            {loadError ? (
              <div className="page load-error" style={{ width: geo.pageW * (geo.phone ? 1 : 2), height: geo.pageH }}>
                <p>{loadError}</p>
                <button type="button" className="btn btn-accent" onClick={onBack}>Back to shelf</button>
              </div>
            ) : (
              <div ref={spreadWrapRef} className="pinch-wrap">
              <Spread pages={pages} swipe={zoom <= 1 || mode === 'text'} pageW={frameW} pageH={frameH} renderPage={renderOne}
                animate={settings.pageAnimation} reduced={reduced}
                canPrev={canPrev} canNext={canNext} onPrev={prev} onNext={next} />
              </div>
            )}
            {!geo.phone && (
              <div className="reader-controls" style={{ width: Math.max(frameW, zoomView ? 560 : 0) * (zoomView ? 1 : 2) }}>
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

      {geo.phone && panelHidden && (
        <PanelReveal page={page} count={count} pageNotes={notes.filter((n) => n.page === page).length}
          onShow={() => setPanelHidden(false)} />
      )}

      {geo.phone && !panelHidden && (
        <PhoneSheet onHide={() => setPanelHidden(true)}
          open={sheetOpen} setOpen={setSheetOpen} book={book} notes={notes} page={page} count={count}
          activeNoteId={activeNoteId} onSelect={selectNote} color={sheetColor} setColor={setSheetColor}
          attachQuote={attach?.quote} onSubmit={onSubmitNote} onCancelAttach={() => setAttach(null)} inputRef={inputRef}
          slider={slider} prev={prev} next={next} canPrev={canPrev} canNext={canNext}
          extras={<div className="sheet-tools">{zoomControl}{modeButton}
            <button type="button" className="icon-btn outline" aria-label="Search in book" onClick={() => { setSearchOpen(true); setSheetOpen(false); }}><IconSearch /></button>
            {themeSwitch}</div>}
        />
      )}

      <SelectionToolbar root={rootEl} onHighlight={onHighlight} onNote={onNoteFromSelection} />
    </div>
  );
}

/** Shown when the notes panel is hidden: a round button (and an upward swipe at the bottom edge) brings it back. */
function PanelReveal({ page, count, pageNotes, onShow }: { page: number; count: number; pageNotes: number; onShow: () => void }) {
  const startY = useRef<number | null>(null);
  return (
    <>
      <div className="panel-swipe-zone" aria-hidden="true"
        onPointerDown={(e) => { startY.current = e.clientY; }}
        onPointerUp={(e) => { if (startY.current !== null && startY.current - e.clientY > 30) onShow(); startY.current = null; }} />
      <div className="panel-reveal">
        <span className="panel-reveal-page" aria-hidden="true">p. {page} / {count}</span>
        <button type="button" className="panel-reveal-btn" onClick={onShow}
          aria-label={`Show notes and page controls${pageNotes ? ` (${pageNotes} on this page)` : ''}`}>
          <IconNote size={22} />
          {pageNotes > 0 && <span className="panel-reveal-badge">{pageNotes}</span>}
        </button>
      </div>
      <div className="panel-reveal-progress" aria-hidden="true"><span style={{ transform: `scaleX(${count > 1 ? (page - 1) / (count - 1) : 1})` }} /></div>
    </>
  );
}

function PhoneSheet(props: {
  onHide: () => void;
  open: boolean; setOpen: (o: boolean) => void; book: Book; notes: Note[]; page: number; count: number;
  activeNoteId: string | null; onSelect: (n: Note) => void; color: string; setColor: (c: string) => void;
  attachQuote?: string; onSubmit: (t: string) => void; onCancelAttach: () => void; inputRef: React.RefObject<HTMLInputElement>;
  slider: React.ReactNode; prev: () => void; next: () => void; canPrev: boolean; canNext: boolean; extras: React.ReactNode;
}) {
  const { open, setOpen, book, notes, page } = props;
  const [tab, setTab] = useState<NotesTab>('page');
  const counts = noteCounts(notes);
  const list = sortNotes(tab === 'page' ? notes.filter((n) => n.page === page) : notes);
  // Swipe the handle: up = more notes, down = smaller, then hidden. A tap toggles the notes list.
  const swipe = useRef<{ y: number; moved: boolean } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => { swipe.current = { y: e.clientY, moved: false }; };
  const onHandleUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (dy > 40) { s.moved = true; if (open) setOpen(false); else props.onHide(); }
    else if (dy < -40) { s.moved = true; setOpen(true); }
  };
  return (
    <section className={'sheet' + (open ? ' open' : '')} aria-label="Notes and page controls">
      <div className="sheet-top">
        <button type="button" className="sheet-handle" aria-expanded={open}
          onPointerDown={onHandleDown} onPointerUp={onHandleUp}
          onClick={() => { if (swipe.current?.moved) { swipe.current = null; return; } swipe.current = null; setOpen(!open); }}
          aria-label={open ? 'Show fewer controls' : `Show notes (${counts.notes} notes, ${counts.highlights} highlights)`}>
          <span />
        </button>
        <button type="button" className="icon-btn sm sheet-hide" onClick={props.onHide}
          aria-label="Hide the notes panel" title="Hide (bring it back with the notes button)">
          <IconChevronDown size={20} />
        </button>
      </div>
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
