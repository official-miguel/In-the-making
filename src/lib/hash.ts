let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (h: string) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; hash?: string; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.hash) p.resolve(e.data.hash);
      else p.reject(new Error(e.data.error || 'hash failed'));
    };
  }
  return worker;
}

/** SHA-256 of a file, computed in a Web Worker. */
export function hashFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, file });
  });
}

export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
