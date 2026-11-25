import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type ReadingMode = 'book' | 'text';

export interface Book {
  id: string;
  fileHash: string;
  title: string;
  author?: string;
  pageCount: number;
  color: string;
  spineHeight: number;
  createdAt: number;
  lastOpenedAt: number;
  lastPage: number;
  readingMode: ReadingMode;
  collectionId: string;
  orderIndex: number;
  hasText?: boolean;
  fileName?: string;
  /**
   * Shared library state. 'local' = only on this device (not shared yet),
   * 'synced' = shared and the PDF is on this device, 'remote' = shared, PDF not downloaded here yet.
   */
  cloud?: 'local' | 'synced' | 'remote';
  remoteId?: string;
  remotePath?: string;
  uploadedBy?: string | null;
  sizeBytes?: number;
}

/** The PDF itself lives in its own store, so listing books never loads large files. */
export interface BookFile { id: string; pdfBlob: Blob }
export interface Cover { id: string; blob: Blob }
export interface Collection { id: string; name: string; orderIndex: number }
/** Highlight rectangle as fractions of the rendered page (survives zoom and resize). */
export interface NoteRect { x: number; y: number; w: number; h: number }

export interface Note {
  id: string;
  bookId: string;
  page: number;
  quote?: string;
  text: string;
  color?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  rects?: NoteRect[];
}

export interface Bookmark { id: string; bookId: string; page: number; createdAt: number }

interface Schema extends DBSchema {
  books: { key: string; value: Book; indexes: { fileHash: string } };
  files: { key: string; value: BookFile };
  covers: { key: string; value: Cover };
  collections: { key: string; value: Collection };
  notes: { key: string; value: Note; indexes: { bookId: string } };
  bookmarks: { key: string; value: Bookmark; indexes: { bookId: string } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<Schema>('bookshelf-reader', 1, {
      upgrade(d) {
        const books = d.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('fileHash', 'fileHash', { unique: true });
        d.createObjectStore('files', { keyPath: 'id' });
        d.createObjectStore('covers', { keyPath: 'id' });
        d.createObjectStore('collections', { keyPath: 'id' });
        const notes = d.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('bookId', 'bookId');
        const bm = d.createObjectStore('bookmarks', { keyPath: 'id' });
        bm.createIndex('bookId', 'bookId');
        d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

export async function getPdfBlob(bookId: string): Promise<Blob | undefined> {
  return (await (await db()).get('files', bookId))?.pdfBlob;
}
