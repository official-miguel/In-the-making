import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import type { Book } from '../lib/db';
import { spineSplit, spineTextColor, spineWidthForPages, tint } from '../lib/colors';

export const PHONE_SPINE_SCALE = 0.68;

export function spineSize(book: Book, k = 1) {
  return { w: Math.round(spineWidthForPages(book.pageCount) * (k < 1 ? 0.9 : 1)), h: Math.round(book.spineHeight * k) };
}

export function percentRead(book: Book) {
  if (!book.lastOpenedAt || book.pageCount <= 1) return 0;
  return Math.round((Math.min(book.lastPage, book.pageCount) / book.pageCount) * 100);
}

/** Spines show the main title only ("Algorithms: A Long Reference" → "Algorithms"); the card shows it all. */
export function spineTitle(title: string) {
  const main = title.split(/\s*[:–—|]\s*|\s+-\s+/)[0].trim();
  return main.length >= 3 ? main : title;
}

/** Purely visual spine: generated from the title, colour and page count, never from the PDF. */
export function SpineFace({ book, w, h, className = '', style }: { book: Book; w: number; h: number; className?: string; style?: CSSProperties }) {
  const fg = spineTextColor(book.color);
  const split = spineSplit(book.title);
  const pct = percentRead(book);
  const light = fg === '#FFFFFF';
  return (
    <span
      className={'spine-face ' + className}
      style={{
        width: w, height: h,
        background: `linear-gradient(to bottom, ${book.color} 0 ${split * 100}%, ${tint(book.color, 0.2)} ${split * 100}% 100%)`,
        color: fg,
        ...style,
      }}
    >
      <span className="spine-band" style={{ top: 11 }} />
      <span className="spine-band" style={{ bottom: 13 }} />
      <span
        className="spine-title"
        style={{
          maxHeight: h - 34,
          fontSize: h < 120 ? 11.5 : w >= 44 ? 14 : 13,
          fontWeight: light ? 700 : 450,
        }}
      >
        {spineTitle(book.title)}
      </span>
      {pct > 0 && (
        <span className="spine-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${pct / 100})`, background: light ? 'rgba(255,255,255,.9)' : 'rgba(15,23,42,.7)' }} />
        </span>
      )}
    </span>
  );
}

type SpineProps = HTMLAttributes<HTMLButtonElement> & {
  book: Book;
  k: number;
  active: boolean;
  dimmed: boolean;
  hidden: boolean;
  dragging: boolean;
  notesCount: number;
};

export const BookSpine = forwardRef<HTMLButtonElement, SpineProps>(function BookSpine(
  { book, k, active, dimmed, hidden, dragging, notesCount, ...rest }, ref,
) {
  const { w, h } = spineSize(book, k);
  const pct = percentRead(book);
  return (
    <button
      ref={ref}
      type="button"
      className="spine"
      data-book-id={book.id}
      data-active={active || undefined}
      data-dimmed={dimmed || undefined}
      data-dragging={dragging || undefined}
      style={{ width: w, height: h, visibility: hidden ? 'hidden' : undefined }}
      aria-label={`${book.title}. ${book.pageCount} pages, ${pct}% read, ${notesCount} notes`}
      {...rest}
    >
      <SpineFace book={book} w={w} h={h} />
    </button>
  );
});
