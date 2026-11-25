import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Book as BookT } from '../lib/db';
import { db, getPdfBlob } from '../lib/db';
import { loadDocument, renderThumbnail } from '../lib/pdf';
import { closedBookRect, viewportSize, type Rect } from '../lib/layout';
import { spineTextColor } from '../lib/colors';
import { PHONE_SPINE_SCALE, SpineFace, spineSize } from './BookSpine';

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SLIDE_MS = 250;
const TURN_MS = 450;
const HINGE_MS = 600;

/** Designed front cover: never a stretched PDF page. */
export function Cover({ book, w, thumbUrl }: { book: BookT; w: number; thumbUrl?: string | null }) {
  const fg = spineTextColor(book.color);
  return (
    <div className="cover-front" style={{ background: book.color, color: fg, ['--cw' as string]: `${w}px` }}>
      <span className="cover-band top" />
      {thumbUrl ? (
        <>
          <div className="cover-thumb"><img src={thumbUrl} alt="" /></div>
          <div className="cover-title small">{book.title}</div>
        </>
      ) : (
        <>
          <div className={'cover-title' + (book.title.length > 60 ? ' long' : book.title.length > 30 ? ' mid' : '')}>{book.title}</div>
          {book.author && <div className="cover-author">{book.author}</div>}
        </>
      )}
      <div className="cover-meta">{book.pageCount} pages</div>
      <span className="cover-band bottom" />
    </div>
  );
}

/** Optional "use first page as cover": a small contain-fitted image, cached in IndexedDB. */
export function useCoverThumb(book: BookT, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) { setUrl(null); return; }
    let alive = true;
    let made: string | null = null;
    (async () => {
      const d = await db();
      let blob = (await d.get('covers', book.id))?.blob;
      if (!blob) {
        const pdf = await getPdfBlob(book.id);
        if (!pdf) return;
        const doc = await loadDocument(book.id, pdf);
        blob = (await renderThumbnail(doc, 360)) ?? undefined;
        if (blob) await d.put('covers', { id: book.id, blob });
      }
      if (blob && alive) { made = URL.createObjectURL(blob); setUrl(made); }
    })().catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [book.id, enabled]);
  return url;
}

interface Props {
  book: BookT;
  mode: 'open' | 'close';
  spineRect: DOMRect | null;
  isPhone: boolean;
  paper: string;
  thumbUrl: string | null;
  sheetHidden?: boolean;
  /** Open: the reader can start fading in. Close: the reader can be removed. */
  onMid: () => void;
  onDone: () => void;
}

/**
 * The 3D book used for opening and closing:
 * spine slides out → turns to face you while growing to the centre → cover swings open on its hinge.
 * Only transform and opacity are animated.
 */
export function BookOpener({ book, mode, spineRect, paper, thumbUrl, sheetHidden, onMid, onDone }: Props) {
  const vp = viewportSize();
  const T: Rect = closedBookRect(vp.w, vp.h, { sheetHidden });
  const W = T.w, H = T.h;
  const shelf = spineSize(book, vp.w <= 899 ? PHONE_SPINE_SCALE : 1);
  const sRect = spineRect ?? new DOMRect(T.x, T.y + H / 2 - shelf.h / 2, shelf.w, shelf.h);
  const s = sRect.height / H;
  const D = Math.max(14, sRect.width / s);
  const dx = sRect.left + sRect.width / 2 - T.x;
  const dy = sRect.top + sRect.height / 2 - (T.y + H / 2);

  const bookRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const atSpine = `translate(${dx}px, ${dy}px) scale(${s}) rotateY(90deg)`;
  const pulled = `translate(${dx}px, ${dy - 14}px) scale(${s * 1.06}) rotateY(90deg)`;
  const centred = 'translate(0px, 0px) scale(1) rotateY(0deg)';
  const coverShut = `translateZ(${D / 2}px) rotateY(0deg)`;
  const coverOpen = `translateZ(${D / 2}px) rotateY(-170deg)`;

  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    const book3d = bookRef.current!, cover = coverRef.current!, back = backRef.current!, root = rootRef.current!;
    const total = SLIDE_MS + TURN_MS;
    const run = async () => {
      if (mode === 'open') {
        back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: total, easing: 'ease-out', fill: 'forwards' });
        await book3d.animate(
          [
            { transform: atSpine, offset: 0, easing: EASE },
            { transform: pulled, offset: SLIDE_MS / total, easing: EASE },
            { transform: centred, offset: 1 },
          ],
          { duration: total, fill: 'forwards' },
        ).finished;
        await cover.animate([{ transform: coverShut }, { transform: coverOpen }], { duration: HINGE_MS, easing: EASE, fill: 'forwards' }).finished;
        onMid();
        await root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 60, easing: 'ease-out', fill: 'forwards' }).finished;
        onDone();
      } else {
        await root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }).finished;
        onMid();
        await cover.animate([{ transform: coverOpen }, { transform: coverShut }], { duration: HINGE_MS, easing: EASE, fill: 'forwards' }).finished;
        back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: total, easing: 'ease-in', fill: 'forwards' });
        await book3d.animate(
          [
            { transform: centred, offset: 0, easing: EASE },
            { transform: pulled, offset: TURN_MS / total, easing: EASE },
            { transform: atSpine, offset: 1 },
          ],
          { duration: total, fill: 'forwards' },
        ).finished;
        onDone();
      }
    };
    run().catch(() => onDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialBook = mode === 'open' ? atSpine : centred;
  const initialCover = mode === 'open' ? coverShut : coverOpen;

  return (
    <div className={`opener paper-${paper}`} ref={rootRef} aria-hidden="true">
      <div className="opener-backdrop" ref={backRef} style={{ opacity: mode === 'open' ? 0 : 1 }} />
      <div className="b3d" ref={bookRef} style={{ left: T.x, top: T.y, width: W, height: H, transform: initialBook }}>
        <div className="b3d-back" style={{ background: book.color, transform: `translateZ(${-D / 2}px) rotateY(180deg)` }} />
        <div className="b3d-pages" style={{ transform: `translateZ(${D / 2 - 2}px)` }}>
          <div className="b3d-page-lines" />
        </div>
        <div className="b3d-edge" style={{ width: D, left: W - D / 2, transform: 'rotateY(90deg)' }} />
        <div className="b3d-spine" style={{ width: D, left: -D / 2, transform: 'rotateY(-90deg)' }}>
          <div style={{ transform: `scale(${1 / s})`, transformOrigin: '0 0', width: shelf.w, height: shelf.h }}>
            <SpineFace book={book} w={shelf.w} h={shelf.h} />
          </div>
        </div>
        <div className="b3d-cover" ref={coverRef} style={{ transform: initialCover }}>
          <Cover book={book} w={W} thumbUrl={thumbUrl} />
          <div className="cover-inside" />
        </div>
      </div>
    </div>
  );
}
