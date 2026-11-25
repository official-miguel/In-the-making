import { useEffect, useState } from 'react';
import type { NoteRect } from '../lib/db';
import { HIGHLIGHT_COLORS, HIGHLIGHT_NAMES } from '../lib/colors';

export interface SelectionInfo { page: number; quote: string; rects?: NoteRect[]; anchor: DOMRect }

/** Read the current text selection inside a reader page. */
function readSelection(root: HTMLElement): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement);
  const pageEl = startEl?.closest<HTMLElement>('.page[data-page]');
  if (!pageEl || !root.contains(pageEl) || pageEl.closest('.leaf')) return null;
  const quote = sel.toString().replace(/\s+/g, ' ').trim();
  if (quote.length < 2) return null;
  const page = Number(pageEl.dataset.page);
  const anchor = range.getBoundingClientRect();
  const fitbox = pageEl.querySelector<HTMLElement>('.fitbox');
  let rects: NoteRect[] | undefined;
  if (fitbox && fitbox.offsetWidth) {
    const fb = fitbox.getBoundingClientRect();
    const raw = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1 && r.height < fb.height * 0.2)
      .map((r) => ({ x: (r.left - fb.left) / fb.width, y: (r.top - fb.top) / fb.height, w: r.width / fb.width, h: r.height / fb.height }))
      .filter((r) => r.x > -0.02 && r.y > -0.02 && r.x < 1 && r.y < 1);
    // Merge pieces on the same line into one bar.
    const lines: NoteRect[] = [];
    for (const r of raw.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const l = lines.find((x) => Math.abs(x.y + x.h / 2 - (r.y + r.h / 2)) < Math.max(x.h, r.h) * 0.5);
      if (l) {
        const x1 = Math.min(l.x, r.x), x2 = Math.max(l.x + l.w, r.x + r.w);
        const y1 = Math.min(l.y, r.y), y2 = Math.max(l.y + l.h, r.y + r.h);
        Object.assign(l, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      } else lines.push({ ...r });
    }
    rects = lines.map((r) => ({ x: +r.x.toFixed(5), y: +r.y.toFixed(5), w: +r.w.toFixed(5), h: +r.h.toFixed(5) }));
    if (!rects.length) rects = undefined;
  }
  return { page, quote: quote.slice(0, 1200), rects, anchor };
}

interface Props {
  root: HTMLElement | null;
  onHighlight: (info: SelectionInfo, color: string) => void;
  onNote: (info: SelectionInfo) => void;
}

/** Floating toolbar above selected text: four highlight colours and "+ Note". */
export function SelectionToolbar({ root, onHighlight, onNote }: Props) {
  const [info, setInfo] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    if (!root) return;
    let t = 0;
    const update = () => {
      clearTimeout(t);
      t = window.setTimeout(() => setInfo(readSelection(root)), 120);
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('resize', update);
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('resize', update);
    };
  }, [root]);

  if (!info) return null;
  const top = Math.max(8, info.anchor.top - 58);
  const left = Math.min(window.innerWidth - 116, Math.max(116, info.anchor.left + info.anchor.width / 2));
  const done = () => { window.getSelection()?.removeAllRanges(); setInfo(null); };

  return (
    <div className="sel-toolbar" role="toolbar" aria-label="Highlight selection" style={{ top, left }}
      onPointerDown={(e) => e.preventDefault()}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c} type="button" className="hl-dot" style={{ background: c }}
          aria-label={`Highlight ${HIGHLIGHT_NAMES[c]}`} onClick={() => { onHighlight(info, c); done(); }} />
      ))}
      <span className="sel-sep" aria-hidden="true" />
      <button type="button" className="btn btn-accent btn-sm" onClick={() => { onNote(info); done(); }}>+ Note</button>
    </div>
  );
}
