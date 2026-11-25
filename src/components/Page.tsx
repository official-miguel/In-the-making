import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Book, Note } from '../lib/db';
import {
  getPageParagraphs, peekRendered, pdfjs, renderPage, type Fit, type PDFDocumentProxy, type Rendered,
} from '../lib/pdf';
import { IconNote } from './Icons';

export interface PageProps {
  book: Book;
  doc: PDFDocumentProxy | null;
  pageNum: number;
  w: number;
  h: number;
  mode: 'book' | 'text';
  notes: Note[];
  flashId: string | null;
  margin: number;
  /** 1 = fit the page; >1 = magnified (book mode scrolls, text mode gets bigger letters). */
  zoom: number;
  onMarker?: (note: Note) => void;
  onSwitchToBook?: () => void;
  side?: 'left' | 'right' | 'single';
}

/** One paper page. PDF pages are contain-fitted onto it, so any PDF size looks like a book page. */
export const Page = memo(function Page(props: PageProps) {
  const { book, pageNum, w, h, side = 'single' } = props;
  let body: ReactNode;
  if (pageNum < 1) body = <InsideCover book={book} />;
  else if (pageNum > book.pageCount) body = <EndPaper />;
  else if (props.mode === 'text') body = <TextPage {...props} />;
  else body = <PdfCanvasPage {...props} />;
  return (
    <div className={`page page-${side}`} data-page={pageNum >= 1 && pageNum <= book.pageCount ? pageNum : undefined} style={{ width: w, height: h }}>
      {body}
      {props.mode === 'text' && pageNum >= 1 && pageNum <= book.pageCount && <span className="page-number" aria-hidden="true">{pageNum}</span>}
    </div>
  );
});

function InsideCover({ book }: { book: Book }) {
  return (
    <div className="inside-cover">
      <span className="inside-cover-band" style={{ background: book.color }} />
      <p className="inside-cover-title">{book.title}</p>
      {book.author && <p className="inside-cover-author">{book.author}</p>}
      <p className="inside-cover-meta">{book.pageCount} pages</p>
    </div>
  );
}

function EndPaper() {
  return <div className="end-paper"><span>The end</span></div>;
}

function PdfCanvasPage({ book, doc, pageNum, w: frameW, h: frameH, notes, flashId, margin: frameMargin, zoom, onMarker }: PageProps) {
  // Zoom renders the page larger (sharp, not stretched) inside the same page frame, which then scrolls.
  const w = Math.round(frameW * zoom), h = Math.round(frameH * zoom), margin = Math.round(frameMargin * zoom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevZoom = useRef(zoom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit | null>(() => peekRendered(book.id, pageNum, w, h, margin)?.fit ?? null);
  const [failed, setFailed] = useState(false);

  const draw = (r: Rendered) => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = r.canvas.width;
    c.height = r.canvas.height;
    c.getContext('2d')!.drawImage(r.canvas, 0, 0);
  };

  // Draw synchronously if this page is already in the cache (no flash during page turns).
  useLayoutEffect(() => {
    const hit = peekRendered(book.id, pageNum, w, h, margin);
    if (hit) {
      setFit(hit.fit);
      draw(hit);
    }
  }, [book.id, pageNum, w, h, margin]);

  useEffect(() => {
    if (!doc) return;
    let alive = true;
    let cleanup = () => {};
    setFailed(false);
    // Pages flicked past (slider drags) are never rendered: wait a moment unless already cached.
    const cached = !!peekRendered(book.id, pageNum, w, h, margin);
    const wait = cached ? Promise.resolve() : new Promise((r) => setTimeout(r, 70));
    wait.then(() => (alive ? renderPage(book.id, doc, pageNum, w, h, margin) : Promise.reject(new Error('skipped'))))
      .then((r) => {
        if (!alive) return;
        setFit(r.fit);
        requestAnimationFrame(() => alive && draw(r));
        // Text layer for selection, highlights and notes.
        const tl = textRef.current;
        if (!tl) return;
        tl.replaceChildren();
        tl.style.setProperty('--scale-factor', String(r.fit.scale));
        const viewport = r.page.getViewport({ scale: r.fit.scale });
        const layer = new pdfjs.TextLayer({ textContentSource: r.page.streamTextContent(), container: tl, viewport });
        layer.render().catch(() => {});
        cleanup = () => layer.cancel();
      })
      .catch((e) => { if (alive) { console.error(e); setFailed(true); } });
    // (a rejected "skipped" wait only happens after unmount, when alive is false)
    return () => { alive = false; cleanup(); };
  }, [doc, book.id, pageNum, w, h, margin]);

  // Keep the same spot in the middle of the view when zooming in or out.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const before = prevZoom.current;
    prevZoom.current = zoom;
    if (!el || before === zoom) return;
    const k = zoom / before;
    const cx = el.scrollLeft + el.clientWidth / 2, cy = el.scrollTop + el.clientHeight / 2;
    el.scrollLeft = cx * k - el.clientWidth / 2;
    el.scrollTop = cy * k - el.clientHeight / 2;
  }, [zoom]);

  const marked = notes.filter((n) => n.rects?.length);
  return (
    <div ref={scrollRef} className={'page-scroll' + (zoom > 1 ? ' zoomed' : '')} tabIndex={zoom > 1 ? 0 : undefined}
      aria-label={zoom > 1 ? `Page ${pageNum}, zoomed ${Math.round(zoom * 100)}%. Scroll to move around.` : undefined}>
    <div className="page-zoom" style={{ width: w, height: h }}>
      {!fit && !failed && <div className="page-loading" aria-hidden="true"><span /></div>}
      {failed && <div className="page-error">This page could not be drawn.</div>}
      <div className="fitbox" style={fit ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h } : { display: 'none' }}>
        <canvas ref={canvasRef} className="page-canvas" aria-label={`Page ${pageNum}`} role="img" />
        <div className="hl-layer" aria-hidden="true">
          {marked.flatMap((n) =>
            n.rects!.map((r, i) => (
              <span key={n.id + i} className={'hl' + (flashId === n.id ? ' flash' : '')}
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: n.color || '#F2D675' }} />
            )),
          )}
        </div>
        <div ref={textRef} className="textLayer" />
        {marked.filter((n) => n.text).map((n) => (
          <button key={n.id} type="button" className="note-marker" aria-label={`Note on page ${pageNum}: ${n.text}`}
            style={{ top: `${n.rects![0].y * 100}%` }} onClick={() => onMarker?.(n)}>
            <IconNote size={12} />
          </button>
        ))}
      </div>
    </div>
    </div>
  );
}

function TextPage({ book, doc, pageNum, notes, flashId, zoom, onSwitchToBook }: PageProps) {
  const [paras, setParas] = useState<string[] | null>(null);
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setParas(null);
    getPageParagraphs(book.id, doc, pageNum).then((p) => alive && setParas(p)).catch(() => alive && setParas([]));
    return () => { alive = false; };
  }, [doc, book.id, pageNum]);

  if (paras === null) return <div className="page-loading" aria-hidden="true"><span /></div>;
  if (!paras.length) {
    return (
      <div className="text-empty">
        <p className="text-empty-title">{book.hasText === false ? 'This PDF is scanned' : 'No text on this page'}</p>
        <p>{book.hasText === false
          ? 'It has pictures of pages but no text layer, so it can only be read in book mode.'
          : 'This page may be an image or a diagram. Book mode shows it as it was printed.'}</p>
        {onSwitchToBook && <button type="button" className="btn btn-accent" onClick={onSwitchToBook}>Read in book mode</button>}
      </div>
    );
  }
  const quoted = notes.filter((n) => n.quote && n.quote.length > 2);
  return (
    <div className="text-page" tabIndex={0} aria-label={`Page ${pageNum} text`} style={{ ['--text-zoom' as string]: zoom }}>
      {paras.map((p, i) => <p key={i}>{markQuotes(p, quoted, flashId)}</p>)}
    </div>
  );
}

/** Wrap parts of a paragraph that match saved quotes in <mark>. */
function markQuotes(text: string, notes: Note[], flashId: string | null): ReactNode {
  if (!notes.length) return text;
  const ranges: { s: number; e: number; n: Note }[] = [];
  const lower = text.toLowerCase();
  for (const n of notes) {
    const q = n.quote!.replace(/\s+/g, ' ').trim().toLowerCase();
    // Quotes may span paragraphs: match the longest leading or trailing part that fits here.
    let idx = lower.indexOf(q);
    let len = q.length;
    if (idx < 0 && q.length > 24) {
      const head = q.slice(0, 24);
      const tail = q.slice(-24);
      const hi = lower.indexOf(head);
      const ti = lower.indexOf(tail);
      if (hi >= 0) { idx = hi; len = text.length - hi; }
      else if (ti >= 0) { idx = 0; len = ti + 24; }
    }
    if (idx >= 0) ranges.push({ s: idx, e: idx + len, n });
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a.s - b.s);
  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.s < pos) return;
    out.push(text.slice(pos, r.s));
    out.push(
      <mark key={i} className={'text-hl' + (flashId === r.n.id ? ' flash' : '')} style={{ background: r.n.color || '#F2D675' }}>
        {text.slice(r.s, r.e)}
      </mark>,
    );
    pos = r.e;
  });
  out.push(text.slice(pos));
  return out;
}
