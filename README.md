# Better Me

Keep your PDFs on an animated bookshelf, open them like real books, and take short notes while reading.
Built by [Trillionaire Designs](https://trillionairedesigns.co.ke).

Installable PWA for PC and Android. Works offline; every book added is shared with all devices through Supabase.

## Run it

```
npm install          # also copies pdf.js fonts/cMaps into public/pdfjs
npm run dev          # http://localhost:5173
npm run build        # type-check + production build with service worker
npm run preview      # serve the build (http://localhost:4173) to test install/offline
```

Test PDFs (A4 text, landscape slides, scanned/no text layer, 500 pages, very long title, plus 28 filler books):

```
node scripts/make-test-pdfs.mjs   # writes ./test-pdfs
```

## How PDFs are made to look like books

- **Spines are generated** (`components/BookSpine.tsx`, `lib/titles.ts`, `lib/colors.ts`).
  Title = PDF metadata → biggest text near the top of page 1 → cleaned file name.
  Colour and height come from a hash of the title, width from the page count:
  `clamp(30px, 24px + pages × 0.12px, 56px)`. The spine shows the main title (before a `:`);
  hover/focus/tap shows the full title.
- **Covers are generated** (`components/Book.tsx`): spine colour, Fraunces title, page count.
  Optional setting: show page 1 small and contain-fitted on that cover (never stretched).
- **Pages are fitted** (`lib/pdf.ts`, `components/Page.tsx`): every PDF page is drawn with
  contain scaling onto a fixed 5:8 paper page, at devicePixelRatio, so slides and odd sizes are
  letterboxed. Visible pages + 2 ahead are rendered and kept in an LRU cache.
- **Text mode** reflows the text layer into the book font; scanned PDFs get a friendly note.

## Layout

```
src/
  components/  Shelf, BookSpine, BookCard, Book (open/close animation + cover), Reader,
               Spread (page curl), Page, NotesPanel, SelectionToolbar, AllNotes, Settings, Overlays
  lib/         pdf (pdf.js), db (IndexedDB), hash (+ worker), titles, colors, layout, export
  state/       store (books, rows, notes, bookmarks, settings, import queue)
```

Animations use only `transform` and `opacity`, and fall back to fades with `prefers-reduced-motion`.

## Shared library (every book on every device)

Every book anyone adds is visible to everyone. Reading needs no account; adding books needs an
email sign-in link. Only the person who added a book (or an admin) can remove it for everyone.
Notes, highlights, bookmarks and reading progress stay private on each device.

1. In the Supabase project, run `supabase/migrations/0001_better_me_shared_library.sql`
   (SQL editor, or `supabase db push`).
2. Copy `.env.example` to `.env.local` and fill in the project URL and anon/publishable key
   (never the service_role key).
3. In Supabase > Authentication > URL Configuration, set the Site URL to where the app is hosted
   (and add `http://localhost:5173` for development).
4. To make someone an admin: `insert into public.betterme_admins (user_id) values ('<their user id>');`

The Supabase free plan limits single uploads to 50 MB (the bucket is set to 50 MB); larger PDFs stay on the device that added them.

## Hosting (so people can install it)

`netlify.toml` and `vercel.json` are included. Set the two `VITE_SUPABASE_*` variables in the host's
environment settings, then deploy. Once it is live over https, phones and PCs can install it
("Install app" button, or "Add to Home Screen" on iPhone) and it works offline.
