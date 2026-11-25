export const BOOK_COLORS = [
  '#E11D48', '#0EA5E9', '#F59E0B', '#7C3AED', '#EC4899', '#10B981', '#F97316', '#3B82F6', '#14B8A6',
] as const;

const WHITE_TEXT = new Set(['#E11D48', '#7C3AED', '#3B82F6']);

export const HIGHLIGHT_COLORS = ['#F2D675', '#9ED0A4', '#8FC1E8', '#F0A3B0'] as const;
export const HIGHLIGHT_NAMES: Record<string, string> = {
  '#F2D675': 'Yellow', '#9ED0A4': 'Green', '#8FC1E8': 'Blue', '#F0A3B0': 'Pink',
};

/** FNV-1a 32-bit string hash: stable across sessions and devices. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colorForTitle(title: string): string {
  return BOOK_COLORS[hashString(title.toLowerCase()) % BOOK_COLORS.length];
}

export function spineTextColor(color: string): string {
  return WHITE_TEXT.has(color.toUpperCase()) ? '#FFFFFF' : '#0F172A';
}

/** Stable spine height between 140 and 180px. */
export function spineHeightForTitle(title: string): number {
  return 140 + (hashString('h:' + title) % 41);
}

/** Spine width from page count: clamp(30px, 24px + pages * 0.12px, 56px). */
export function spineWidthForPages(pages: number): number {
  return Math.round(Math.min(56, Math.max(30, 24 + pages * 0.12)));
}

/** Where the two-tone spine changes shade (fraction from the top), stable per title. */
export function spineSplit(title: string): number {
  return 0.22 + ((hashString('s:' + title) % 100) / 100) * 0.62;
}

/** Mix a hex colour with white (amount 0..1). */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}
