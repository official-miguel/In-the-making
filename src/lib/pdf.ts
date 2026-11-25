import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cleanFileName, isUsefulTitle, tidyTitle } from './titles';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

function open(blob: Blob) {
  // An object URL lets pdf.js stream the file instead of copying it into the main thread.
  const url = URL.createObjectURL(blob);
  const task = pdfjs.getDocument({
    url,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    isEvalSupported: false,
  });
  task.promise.finally(() => setTimeout(() => URL.revokeObjectURL(url), 30_000)).catch(() => {});
  return task;
}

// ---------- documents ----------

const docs = new Map<string, Promise<PDFDocumentProxy>>();

export function loadDocument(bookId: string, blob: Blob): Promise<PDFDocumentProxy> {
  let p = docs.get(bookId);
  if (!p) {
    p = open(blob).promise;
    docs.set(bookId, p);
    p.catch(() => docs.delete(bookId));
    // Keep at most 2 documents open.
    if (docs.size > 2) {
      const [oldest] = docs.keys();
      if (oldest !== bookId) closeDocument(oldest);
    }
  }
  return p;
}

export function closeDocument(bookId: string) {
  const p = docs.get(bookId);
  docs.delete(bookId);
  for (const k of renderCache.keys()) if (k.startsWith(bookId + ':')) { renderCache.delete(k); resolved.delete(k); }
  for (const k of textCache.keys()) if (k.startsWith(bookId + ':')) textCache.delete(k);
  p?.then((d) => d.destroy()).catch(() => {});
}

// ---------- import analysis ----------

export interface PdfInfo { pageCount: number; title: string; author?: string; hasText: boolean }

function fontSize(item: TextItem) {
  return Math.hypot(item.transform[2], item.transform[3]);
}

function isTextItem(i: unknown): i is TextItem {
  return typeof i === 'object' && i !== null && 'str' in i;
}

async function firstBigText(page: PDFPageProxy): Promise<string | null> {
  const tc = await page.getTextContent();
  const items = tc.items.filter(isTextItem).filter((i) => i.str.trim().length > 0);
  if (!items.length) return null;
  const vp = page.getViewport({ scale: 1 });
  // Only consider the top 60% of page 1: headings live there; footers do not.
  const top = items.filter((i) => i.transform[5] > vp.height * 0.4 || vp.height === 0);
  const pool = top.length ? top : items;
  const max = Math.max(...pool.map(fontSize));
  const body = pool.map(fontSize).sort((a, b) => a - b)[Math.floor(pool.length / 2)];
  if (max < body * 1.15 && pool.length > 3) return null; // no heading stands out
  const parts: string[] = [];
  for (const i of pool) {
    if (fontSize(i) >= max * 0.88) parts.push(i.str);
    else if (parts.length) break;
    if (parts.join(' ').length > 120) break;
  }
  const t = parts.join(' ').replace(/\s+/g, ' ').trim();
  return /[A-Za-zÀ-￿]{3}/.test(t) ? t : null;
}

export async function analyzePdf(file: File): Promise<PdfInfo> {
  const doc = await open(file).promise;
  try {
    const pageCount = doc.numPages;
    let title: string | undefined;
    let author: string | undefined;
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as Record<string, unknown> | undefined;
      const metaTitle = (meta.metadata?.get('dc:title') as string | undefined) || (info?.Title as string | undefined);
      if (isUsefulTitle(metaTitle)) title = tidyTitle(metaTitle);
      const a = info?.Author as string | undefined;
      if (a && a.trim().length > 1 && a.length < 80) author = a.trim();
    } catch { /* metadata is optional */ }

    const p1 = await doc.getPage(1);
    if (!title) {
      const big = await firstBigText(p1).catch(() => null);
      if (isUsefulTitle(big)) title = tidyTitle(big);
    }
    if (!title) title = cleanFileName(file.name);

    // Text layer check on the first few pages (scanned PDFs have none).
    let chars = 0;
    for (let n = 1; n <= Math.min(3, pageCount); n++) {
      const pg = n === 1 ? p1 : await doc.getPage(n);
      const tc = await pg.getTextContent();
      chars += tc.items.filter(isTextItem).reduce((s, i) => s + i.str.trim().length, 0);
      if (chars > 40) break;
    }
    return { pageCount, title, author, hasText: chars > 40 };
  } finally {
    doc.destroy();
  }
}

// ---------- rendering ----------

export interface Fit { x: number; y: number; w: number; h: number; scale: number }
export interface Rendered { canvas: HTMLCanvasElement; fit: Fit; page: PDFPageProxy }

const renderCache = new Map<string, Promise<Rendered>>();
const resolved = new Map<string, Rendered>();
const MAX_CACHE = 18;

function renderKey(bookId: string, pageNum: number, frameW: number, frameH: number, margin: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return `${bookId}:${pageNum}:${Math.round(frameW)}x${Math.round(frameH)}:${margin}@${dpr}`;
}

/** A page that is already rendered, so it can be drawn before the next paint (no blank flash). */
export function peekRendered(bookId: string, pageNum: number, frameW: number, frameH: number, margin: number) {
  return resolved.get(renderKey(bookId, pageNum, frameW, frameH, margin));
}

/** Contain-fit a page of size (pw, ph) into a frame, leaving a small paper margin. */
export function fitPage(pw: number, ph: number, frameW: number, frameH: number, margin: number): Fit {
  const scale = Math.min((frameW - margin * 2) / pw, (frameH - margin * 2) / ph);
  const w = pw * scale, h = ph * scale;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h, scale };
}

export function renderPage(
  bookId: string, doc: PDFDocumentProxy, pageNum: number, frameW: number, frameH: number, margin: number,
): Promise<Rendered> {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const key = renderKey(bookId, pageNum, frameW, frameH, margin);
  const hit = renderCache.get(key);
  if (hit) {
    renderCache.delete(key);
    renderCache.set(key, hit); // LRU bump
    return hit;
  }
  const p = (async () => {
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const fit = fitPage(base.width, base.height, frameW, frameH, margin);
    const vp = page.getViewport({ scale: fit.scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const out = { canvas, fit, page };
    if (renderCache.has(key)) resolved.set(key, out);
    return out;
  })();
  renderCache.set(key, p);
  p.catch(() => renderCache.delete(key));
  while (renderCache.size > MAX_CACHE) {
    const [oldest] = renderCache.keys();
    renderCache.delete(oldest);
    resolved.delete(oldest);
  }
  return p;
}

/** Small first-page image used by the optional "use first page as cover" setting. */
export async function renderThumbnail(doc: PDFDocumentProxy, width: number): Promise<Blob | null> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.85));
}

// ---------- text mode ----------

const textCache = new Map<string, Promise<string[]>>();

/** Extract a page's text layer as reflowed paragraphs. */
export function getPageParagraphs(bookId: string, doc: PDFDocumentProxy, pageNum: number): Promise<string[]> {
  const key = `${bookId}:${pageNum}`;
  let p = textCache.get(key);
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(pageNum);
      const tc = await page.getTextContent();
      const items = tc.items.filter(isTextItem);
      const paras: string[] = [];
      let cur = '';
      let lastY: number | null = null;
      let lastSize = 10;
      for (const it of items) {
        const y = it.transform[5];
        const size = fontSize(it) || lastSize;
        if (lastY !== null && it.str.trim()) {
          const gap = Math.abs(lastY - y);
          if (gap > lastSize * 1.9 || (gap > 1 && Math.abs(size - lastSize) > 2.5)) {
            if (cur.trim()) paras.push(cur.trim());
            cur = '';
          } else if (gap > 1 && cur && !cur.endsWith(' ') && !cur.endsWith('-')) {
            cur += ' ';
          }
        }
        if (cur.endsWith('-') && lastY !== null && Math.abs(lastY - y) > 1) cur = cur.slice(0, -1); // re-join hyphenated words
        cur += it.str;
        if (it.hasEOL && !cur.endsWith(' ')) cur += ' ';
        if (it.str.trim()) {
          lastY = y;
          lastSize = size;
        }
      }
      if (cur.trim()) paras.push(cur.trim());
      return paras.map((s) => s.replace(/\s+/g, ' '));
    })();
    textCache.set(key, p);
    if (textCache.size > 60) {
      const [oldest] = textCache.keys();
      textCache.delete(oldest);
    }
  }
  return p;
}
