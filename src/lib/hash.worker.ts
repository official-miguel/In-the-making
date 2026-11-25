/// <reference lib="webworker" />
// Hashes a file off the main thread, so large PDFs never freeze the UI.
self.onmessage = async (e: MessageEvent<{ id: number; file: Blob }>) => {
  const { id, file } = e.data;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    self.postMessage({ id, hash: hex });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
