// Generates the test PDFs from the quality checklist into ./test-pdfs (no dependencies).
//  - A4 text book with no metadata title (title comes from the big heading on page 1)
//  - landscape slide deck, a scanned PDF with no text layer, a 500-page PDF, and a very long title.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WORDS = ('attention river desk morning habit focus page note study chapter quiet current banks phone task week change '
  + 'simple decide minutes goal discipline environment design remove effort practice memory reading library shelf light '
  + 'water soil weather season garden plan market idea question answer method result review table figure value').split(' ');
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sentence = () => {
  const n = 8 + Math.floor(rnd() * 10);
  const w = Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ') + '.';
};
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text, maxChars) {
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > maxChars) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

class Pdf {
  constructor() { this.objs = []; this.pages = []; }
  add(body) { this.objs.push(body); return this.objs.length; }
  stream(dict, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    return this.add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${buf.length} >>\nstream\n`, 'latin1'), buf, Buffer.from('\nendstream', 'latin1')]));
  }
  page(w, h, content, xobjects = '') {
    const c = this.stream('/Filter /FlateDecode', deflateSync(Buffer.from(content, 'latin1')));
    this.pages.push({ w, h, c, xobjects });
  }
  save(file, info = {}) {
    const font = this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontB = this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const fontS = this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
    const pagesId = this.objs.length + this.pages.length + 1;
    const kids = this.pages.map((p) => this.add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Contents ${p.c} 0 R /Resources << /Font << /F1 ${font} 0 R /F2 ${fontB} 0 R /F3 ${fontS} 0 R >> ${p.xobjects ? `/XObject << ${p.xobjects} >>` : ''} >> >>`));
    const pid = this.add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
    if (pid !== pagesId) throw new Error('page tree id mismatch');
    const infoEntries = Object.entries(info).map(([k, v]) => `/${k} (${esc(v)})`).join(' ');
    const infoId = this.add(`<< ${infoEntries} /Producer (bookshelf test generator) >>`);
    const cat = this.add(`<< /Type /Catalog /Pages ${pid} 0 R >>`);
    const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [];
    let len = parts[0].length;
    this.objs.forEach((o, i) => {
      offsets.push(len);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(b);
      len += b.length;
    });
    const xref = [`xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    parts.push(Buffer.from(xref + `trailer\n<< /Size ${this.objs.length + 1} /Root ${cat} 0 R /Info ${infoId} 0 R >>\nstartxref\n${len}\n%%EOF\n`, 'latin1'));
    writeFileSync(file, Buffer.concat(parts));
    console.log('wrote', file, this.pages.length, 'pages');
  }
}

function textPage(pdf, w, h, { heading, sub, pageNo, size = 11, font = 'F1' }) {
  const m = w * 0.12;
  let y = h - m;
  let s = '';
  if (heading) {
    s += `BT /F2 28 Tf ${m} ${y - 20} Td (${esc(heading)}) Tj ET\n`;
    y -= 60;
    if (sub) { s += `BT /F1 14 Tf ${m} ${y} Td (${esc(sub)}) Tj ET\n`; y -= 40; }
  }
  const lead = size * 1.45;
  const chars = Math.floor((w - 2 * m) / (size * 0.5));
  while (y > m + 30) {
    const para = Array.from({ length: 3 + Math.floor(rnd() * 3) }, sentence).join(' ');
    for (const line of wrap(para, chars)) {
      if (y < m + 30) break;
      s += `BT /${font} ${size} Tf ${m} ${y} Td (${esc(line)}) Tj ET\n`;
      y -= lead;
    }
    y -= lead * 0.8;
  }
  s += `BT /F1 9 Tf ${w / 2 - 6} ${m / 2} Td (${pageNo}) Tj ET\n`;
  pdf.page(w, h, s);
}

mkdirSync('test-pdfs', { recursive: true });

// 1. A4 text, no metadata title, messy file name.
{
  const p = new Pdf();
  for (let i = 1; i <= 24; i++) textPage(p, 595, 842, { heading: i === 1 ? 'Habits of Attention' : i % 6 === 0 ? `Chapter ${i / 6 + 1}` : undefined, sub: i === 1 ? 'Notes on where the mind goes first' : undefined, pageNo: i, font: 'F3' });
  p.save('test-pdfs/Habits_of_Attention_final_v2 (1).pdf');
}
// 2. Landscape slide deck.
{
  const p = new Pdf();
  const colors = ['0.88 0.11 0.28', '0.05 0.65 0.91', '0.96 0.62 0.04', '0.49 0.23 0.93'];
  for (let i = 1; i <= 12; i++) {
    const c = colors[i % 4];
    let s = `${c} rg 0 0 960 90 re f 0 0 0 rg\n`;
    s += `BT /F2 40 Tf 60 440 Td (${esc(i === 1 ? 'Quarterly Review' : `Slide ${i}: ${WORDS[i * 3 % WORDS.length]} and ${WORDS[i * 5 % WORDS.length]}`)}) Tj ET\n`;
    for (let k = 0; k < 4; k++) s += `BT /F1 22 Tf 80 ${360 - k * 50} Td (- ${esc(sentence().slice(0, 60))}) Tj ET\n`;
    s += `${c} rg 620 140 ${200} ${60 + (i * 37) % 160} re f\n`;
    p.page(960, 540, s);
  }
  p.save('test-pdfs/quarterly-review-slides.pdf', { Title: 'Quarterly Review 2026' });
}
// 3. Scanned: images only, no text layer.
{
  const p = new Pdf();
  const W = 425, H = 550;
  for (let i = 1; i <= 8; i++) {
    const px = Buffer.alloc(W * H);
    for (let k = 0; k < px.length; k++) px[k] = 228 + Math.floor(rnd() * 18);
    for (let y = 60; y < H - 60; y += 16) {
      const lw = 260 + Math.floor(rnd() * 80);
      for (let x = 50; x < 50 + lw; x++) if (rnd() > 0.25) for (let dy = 0; dy < 7; dy++) px[(y + dy) * W + x] = 50 + Math.floor(rnd() * 40);
    }
    const img = p.stream(`/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(px));
    p.page(612, 792, 'q 612 0 0 792 0 0 cm /Im1 Do Q', `/Im1 ${img} 0 R`);
  }
  p.save('test-pdfs/field_guide_scanned_2019.pdf');
}
// 4. 500 pages.
{
  const p = new Pdf();
  for (let i = 1; i <= 500; i++) textPage(p, 420, 595, { heading: i === 1 ? 'Algorithms' : undefined, pageNo: i, size: 10 });
  p.save('test-pdfs/big-500-pages.pdf', { Title: 'Algorithms: A Long Reference', Author: 'Test Author' });
}
// Extra small books to fill a shelf (varied page counts → varied spine widths).
{
  mkdirSync('test-pdfs/many', { recursive: true });
  const titles = ['Soil & Water', 'Economics I', 'Quiet Sea', 'Anatomy', 'Swahili Basics', 'Notes 2024', 'Chemistry', 'Poetry', 'History I',
    'Biology', 'Law Notes', 'Accounting', 'Statistics', 'Physics', 'Geography', 'Project Brief', 'Marketing', 'Design Basics', 'Data Sheets',
    'Logic', 'Novel draft', 'Cooking', 'Travel', 'Fitness', 'Music Theory', 'Gardening', 'Languages', 'Journal'];
  titles.forEach((t, i) => {
    const p = new Pdf();
    const pages = 2 + ((i * 7) % 9);
    for (let k = 1; k <= pages; k++) textPage(p, 595, 842, { heading: k === 1 ? t : undefined, pageNo: k });
    // Page count shown on the shelf is real; vary it via repeated tiny pages for wider spines.
    const extra = (i * 53) % 220;
    for (let k = 0; k < extra; k++) p.page(595, 842, `BT /F1 10 Tf 60 780 Td (${k + pages + 1}) Tj ET`);
    p.save(`test-pdfs/many/${t.replace(/[^a-z0-9]+/gi, '_')}.pdf`, { Title: t });
  });
}
// 5. Very long title.
{
  const p = new Pdf();
  for (let i = 1; i <= 40; i++) textPage(p, 612, 792, { pageNo: i });
  p.save('test-pdfs/soil-handbook.pdf', { Title: 'The Remarkably Long and Unnecessarily Detailed Handbook of Soil, Water, Weather and Everything Else a Small Farm Might Need to Know' });
}
