// Copies pdf.js standard fonts and cMaps into public/ so they are served (and cached) offline.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/pdfjs-dist');
const out = resolve(root, 'public/pdfjs');
mkdirSync(out, { recursive: true });
cpSync(resolve(src, 'standard_fonts'), resolve(out, 'standard_fonts'), { recursive: true });
cpSync(resolve(src, 'cmaps'), resolve(out, 'cmaps'), { recursive: true });
console.log('pdf.js assets copied to public/pdfjs');
