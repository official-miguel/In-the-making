import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from './Icons';

type Side = 'left' | 'right' | 'single';

interface Props {
  /** [left, right] on desktop, [page] on phones. 0 = inside cover, > pageCount = end paper. */
  pages: number[];
  pageW: number;
  pageH: number;
  renderPage: (n: number, side: Side) => ReactNode;
  animate: boolean;
  reduced: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

interface Turn { dir: 'next' | 'prev'; base: number[]; front: number; back: number | null; target: number[] }

const EASE = 'cubic-bezier(.45,.05,.3,1)';
const TURN_MS = 420;

/** The open book: two fitted pages with a soft spine shadow, and a page that curls over when turning. */
export function Spread({ pages, pageW, pageH, renderPage, animate, reduced, canPrev, canNext, onPrev, onNext }: Props) {
  const span = pages.length;
  const [shown, setShown] = useState(pages);
  const [turn, setTurn] = useState<Turn | null>(null);
  const shownRef = useRef(pages);
  const leafRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);
  const key = pages.join(',');

  useLayoutEffect(() => {
    const prev = shownRef.current;
    if (prev.join(',') === key) return;
    const diff = pages[0] - prev[0];
    shownRef.current = pages;
    if (animate && !reduced && prev.length === span && Math.abs(diff) === span && !turn) {
      if (span === 2) {
        setTurn(diff > 0
          ? { dir: 'next', base: [prev[0], pages[1]], front: prev[1], back: pages[0], target: pages }
          : { dir: 'prev', base: [pages[0], prev[1]], front: prev[0], back: pages[1], target: pages });
      } else {
        setTurn(diff > 0
          ? { dir: 'next', base: [pages[0]], front: prev[0], back: null, target: pages }
          : { dir: 'prev', base: [prev[0]], front: pages[0], back: null, target: pages });
      }
      return;
    }
    setTurn(null);
    setShown(pages);
    // Jumps (slider, notes, search) and reduced motion use a soft fade.
    pagesRef.current?.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: reduced ? 180 : 260, easing: 'ease-out' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useLayoutEffect(() => {
    if (!turn || !leafRef.current) return;
    const leaf = leafRef.current;
    let frames: Keyframe[];
    if (span === 2) frames = turn.dir === 'next'
      ? [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }]
      : [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }];
    else frames = turn.dir === 'next'
      ? [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-92deg)' }]
      : [{ transform: 'rotateY(-92deg)' }, { transform: 'rotateY(0deg)' }];
    const anim = leaf.animate(frames, { duration: TURN_MS, easing: EASE, fill: 'forwards' });
    // Moving shadow: darkens the curling page mid-turn and the page it falls onto.
    leaf.querySelectorAll<HTMLElement>('.leaf-shade').forEach((el) =>
      el.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }], { duration: TURN_MS, easing: 'ease-in-out' }));
    castRef.current?.animate([{ opacity: 0 }, { opacity: 0.6 }, { opacity: 0 }], { duration: TURN_MS, easing: 'ease-in-out' });
    let done = false;
    let cancelled = false;
    const finish = () => {
      if (done || cancelled) return;
      done = true;
      setShown(turn.target);
      setTurn(null);
    };
    anim.finished.then(finish).catch(finish);
    return () => { if (!done) { cancelled = true; anim.cancel(); } };
  }, [turn, span]);

  // Swipe to turn on touch screens.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 60 && Date.now() - s.t < 700) {
      if (dx < 0 && canNext) onNext();
      if (dx > 0 && canPrev) onPrev();
    }
  };

  const base = turn ? turn.base : shown;
  const sides: Side[] = span === 2 ? ['left', 'right'] : ['single'];
  const leafSide: Side = span === 1 ? 'single' : turn?.dir === 'next' ? 'right' : 'left';
  const leafLeft = span === 1 ? 0 : turn?.dir === 'next' ? pageW : 0;
  const origin = span === 1 ? 'left center' : turn?.dir === 'next' ? 'left center' : 'right center';

  return (
    <div
      className={'spread' + (span === 1 ? ' single' : '')}
      style={{ width: pageW * span, height: pageH }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div className="spread-pages" ref={pagesRef}>
        {base.map((n, i) => <div key={sides[i] + n} className="spread-slot">{renderPage(n, sides[i])}</div>)}
      </div>
      {span === 2 && <div className="gutter" aria-hidden="true" />}
      {turn && (
        <>
          <div ref={castRef} className={'cast-shadow ' + (span === 1 ? 'single' : turn.dir)} style={{ width: pageW, left: span === 2 && turn.dir === 'prev' ? pageW : 0 }} aria-hidden="true" />
          <div ref={leafRef} className="leaf" aria-hidden="true"
            style={{ left: leafLeft, width: pageW, height: pageH, transformOrigin: origin }}>
            <div className="leaf-face front">
              {renderPage(turn.front, leafSide)}
              <div className={'leaf-shade ' + (turn.dir === 'next' || span === 1 ? 'from-left' : 'from-right')} />
            </div>
            {turn.back !== null && (
              <div className="leaf-face back">
                {renderPage(turn.back, turn.dir === 'next' ? 'left' : 'right')}
                <div className={'leaf-shade ' + (turn.dir === 'next' ? 'from-right' : 'from-left')} />
              </div>
            )}
          </div>
        </>
      )}
      {span === 2 && (
        <>
          <button type="button" className="edge-zone left" aria-label="Previous page" disabled={!canPrev} onClick={onPrev}>
            <IconChevronLeft size={18} />
          </button>
          <button type="button" className="edge-zone right" aria-label="Next page" disabled={!canNext} onClick={onNext}>
            <IconChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}
