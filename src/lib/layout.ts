/** Shared reader geometry, so the opening animation lands exactly where the book spread is drawn. */
export const PHONE_MAX = 899;
export const READER_TOPBAR = 64;
export const PHONE_TOPBAR = 60;
export const PHONE_SHEET = 204;
export const CONTROLS_H = 44;
export const CONTROLS_GAP = 24;

/** Viewport size without the page scrollbar (fixed layers are laid out in this box). */
export function viewportSize() {
  const de = document.documentElement;
  return { w: de.clientWidth || window.innerWidth, h: de.clientHeight || window.innerHeight };
}

export function notesPanelWidth(vw: number) {
  return vw >= 1200 ? 340 : 300;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface SpreadGeometry {
  phone: boolean;
  /** Each page of the spread (one on phones). */
  pageW: number;
  pageH: number;
  /** Top-left of the whole spread in viewport coordinates. */
  x: number;
  y: number;
  /** Width of the area the spread is centred in. */
  areaW: number;
}

export interface GeometryOptions {
  /** Phone: the notes panel at the bottom is hidden, so the page fills the screen. */
  sheetHidden?: boolean;
}

export function spreadGeometry(vw: number, vh: number, opts: GeometryOptions = {}): SpreadGeometry {
  if (vw <= PHONE_MAX) {
    const pageH = opts.sheetHidden ? vh - PHONE_TOPBAR : vh - PHONE_TOPBAR - PHONE_SHEET + 20;
    return { phone: true, pageW: vw, pageH, x: 0, y: PHONE_TOPBAR, areaW: vw };
  }
  const areaW = vw - notesPanelWidth(vw);
  const areaH = vh - READER_TOPBAR;
  // Portrait 5:8 pages; the spread plus controls is centred in the area.
  let pageH = Math.min(860, areaH - 56 - CONTROLS_GAP - CONTROLS_H - 52);
  let pageW = (pageH * 5) / 8;
  const maxW = (areaW - 96) / 2;
  if (pageW > maxW) {
    pageW = maxW;
    pageH = (pageW * 8) / 5;
  }
  pageW = Math.floor(pageW);
  pageH = Math.floor(pageH);
  const groupH = pageH + CONTROLS_GAP + CONTROLS_H;
  const y = READER_TOPBAR + Math.max(16, (areaH - groupH) / 2);
  const x = Math.round((areaW - pageW * 2) / 2);
  return { phone: false, pageW, pageH, x, y: Math.round(y), areaW };
}

/** Where the closed book sits before its cover swings open (the right-hand page; the whole page on phones). */
export function closedBookRect(vw: number, vh: number, opts: GeometryOptions = {}): Rect {
  const g = spreadGeometry(vw, vh, opts);
  if (g.phone) return { x: 0, y: g.y, w: g.pageW, h: g.pageH };
  return { x: g.x + g.pageW, y: g.y, w: g.pageW, h: g.pageH };
}
