/** Turn "Habits_of-Attention final_v2 (1).pdf" into "Habits Of Attention". */
export function cleanFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, '');
  let s = base.replace(/[_\-.]+/g, ' ');
  s = s.replace(/\((\d+|copy)\)/gi, ' ');
  // Version and draft noise: final, v2, rev3, copy, draft, dates, long numbers.
  s = s.replace(/\b(final|copy|draft\d*|rev\d*|v\d+|version\s?\d+|scan(ned)?|print|ocr)\b/gi, ' ');
  s = s.replace(/\b\d{4}\s\d{1,2}\s\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d{5,}\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = base.trim() || 'Untitled';
  if (s === s.toLowerCase() || s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }
  return s;
}

const JUNK = [
  /^untitled/i, /^microsoft (word|powerpoint|excel)/i, /\.(docx?|pptx?|xlsx?|pdf|tex|indd|dvi|odt)$/i,
  /^slide \d+$/i, /^document\d*$/i, /^title$/i, /^presentation\d*$/i, /^scan/i, /^image\d*$/i,
  /^[\W\d_]+$/, /^(none|null|unknown)$/i, /^powerpoint/i, /^layout \d/i, /^page \d+$/i,
];

export function isUsefulTitle(t: string | undefined | null): t is string {
  if (!t) return false;
  const s = t.trim();
  if (s.length < 3 || s.length > 200) return false;
  return !JUNK.some((re) => re.test(s));
}

export function tidyTitle(t: string): string {
  let s = t.replace(/\s+/g, ' ').trim();
  s = s.replace(/^microsoft word - /i, '');
  if (s === s.toUpperCase() && /[A-Z]/.test(s) && s.length > 4) {
    s = s.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }
  return s;
}
