import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book } from './lib/db';
import { PHONE_MAX } from './lib/layout';
import { addFiles, init, useStore } from './state/store';
import { Shelf } from './components/Shelf';
import { Reader, useReducedMotion } from './components/Reader';
import { BookOpener, useCoverThumb } from './components/Book';
import { AllNotes } from './components/AllNotes';
import { SettingsDialog } from './components/Settings';
import { ImportTray, Toasts } from './components/Overlays';
import { IconBookmark, IconLibrary, IconNote } from './components/Icons';

function useIsPhone() {
  const q = `(max-width: ${PHONE_MAX}px)`;
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

interface OpenState { bookId: string; page?: number; noteId?: string; key: number }
interface Anim { mode: 'open' | 'close'; rect: DOMRect | null }

export default function App() {
  const isPhone = useIsPhone();
  const reduced = useReducedMotion();
  const books = useStore((s) => s.books);
  const settings = useStore((s) => s.settings);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [animBookId, setAnimBookId] = useState<string | null>(null);
  const [readerShown, setReaderShown] = useState(false);
  const [hiddenBookId, setHiddenBookId] = useState<string | null>(null);
  const [phoneView, setPhoneView] = useState<'shelf' | 'notes' | 'saved'>('shelf');
  const [notesDialog, setNotesDialog] = useState<'notes' | 'saved' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pushed = useRef(false);

  useEffect(() => { void init(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = settings.appTheme; }, [settings.appTheme]);

  const animBook = books.find((b) => b.id === animBookId) ?? null;
  const openedBook = open ? books.find((b) => b.id === open.bookId) ?? null : null;
  const thumb = useCoverThumb(animBook ?? openedBook ?? ({ id: '' } as Book), settings.coverFromFirstPage && !!(animBook ?? openedBook));

  const spineRect = (id: string) => {
    const el = document.querySelector<HTMLElement>(`.shelf .spine[data-book-id="${id}"]`);
    if (!el) return null;
    let r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      el.scrollIntoView({ block: 'center' });
      r = el.getBoundingClientRect();
    }
    return r.width ? r : null;
  };

  const doOpen = useCallback((book: Book, page?: number, noteId?: string) => {
    if (open) return;
    setNotesDialog(null);
    const rect = phoneView === 'shelf' ? spineRect(book.id) : null;
    if (!pushed.current) {
      history.pushState({ reader: true }, '');
      pushed.current = true;
    }
    setOpen({ bookId: book.id, page, noteId, key: Date.now() });
    if (reduced || !rect) {
      setReaderShown(true);
      return;
    }
    setReaderShown(false);
    setHiddenBookId(book.id);
    setAnimBookId(book.id);
    setAnim({ mode: 'open', rect });
  }, [open, phoneView, reduced]);

  const doClose = useCallback(() => {
    if (!open || anim) return;
    const id = open.bookId;
    const rect = phoneView === 'shelf' && !reduced ? spineRect(id) : null;
    if (!rect) {
      setReaderShown(false);
      setTimeout(() => { setOpen(null); setHiddenBookId(null); }, reduced ? 120 : 220);
      return;
    }
    setHiddenBookId(id);
    setAnimBookId(id);
    setAnim({ mode: 'close', rect });
  }, [open, anim, phoneView, reduced]);

  // Android back button / browser back closes the book.
  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      doClose();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [doClose]);

  const requestClose = () => {
    if (pushed.current) history.back();
    else doClose();
  };

  const pickFiles = () => fileRef.current?.click();

  // While a book is open the shelf behind it is inert (no focus, no clicks).
  const shelfLayerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = shelfLayerRef.current;
    if (!el) return;
    if (open && readerShown) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
    document.documentElement.classList.toggle('reader-open', !!open);
  }, [open, readerShown]);

  return (
    <div className={'app' + (isPhone ? ' is-phone' : '')}>
      <div className="shelf-layer" ref={shelfLayerRef} aria-hidden={open && readerShown ? true : undefined}>
        {(!isPhone || phoneView === 'shelf') && (
          <Shelf isPhone={isPhone} hiddenBookId={hiddenBookId} onOpen={doOpen}
            onShowNotes={() => setNotesDialog('notes')} onShowSettings={() => setSettingsOpen(true)} pickFiles={pickFiles} />
        )}
        {isPhone && phoneView !== 'shelf' && (
          <AllNotes tab={phoneView} isPhone onOpen={(b, p, n) => doOpen(b, p, n)} />
        )}
        {isPhone && (
          <nav className="bottom-nav" aria-label="Main">
            {([['shelf', 'Shelf', IconLibrary], ['notes', 'All notes', IconNote], ['saved', 'Saved', IconBookmark]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" aria-current={phoneView === id ? 'page' : undefined} onClick={() => setPhoneView(id)}>
                <Icon size={22} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {open && openedBook && (
        <div className={'reader-layer' + (readerShown ? ' shown' : '')}>
          <Reader key={open.key} book={openedBook} isPhone={isPhone} initialPage={open.page} initialNoteId={open.noteId} onBack={requestClose} />
        </div>
      )}

      {anim && animBook && (
        <BookOpener
          key={anim.mode + animBook.id}
          book={animBook}
          mode={anim.mode}
          spineRect={anim.rect}
          isPhone={isPhone}
          paper={settings.paperTheme}
          thumbUrl={thumb}
          onMid={() => {
            if (anim.mode === 'open') setReaderShown(true);
            else { setReaderShown(false); setOpen(null); }
          }}
          onDone={() => {
            setAnim(null);
            setAnimBookId(null);
            if (anim.mode === 'close') setHiddenBookId(null);
          }}
        />
      )}

      {notesDialog && !isPhone && (
        <div className="modal-scrim" onClick={() => setNotesDialog(null)} onKeyDown={(e) => e.key === 'Escape' && setNotesDialog(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <AllNotes tab={notesDialog} setTab={setNotesDialog} isPhone={false} onOpen={(b, p, n) => doOpen(b, p, n)} onClose={() => setNotesDialog(null)} />
          </div>
        </div>
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      <ImportTray isPhone={isPhone} />
      <Toasts />
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
