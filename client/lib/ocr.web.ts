/**
 * Browser OCR with Tesseract.js (WebAssembly, runs locally; free).
 * The engine and English model are self-hosted from /ocr (copied there by
 * scripts/copy-ocr-assets.js) rather than fetched from public CDNs.
 * First use downloads ~7 MB, which the browser then caches.
 */
import { createWorker, type Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;

export async function readText(imageUri: string): Promise<string> {
  worker ??= createWorker('eng', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr',
    langPath: '/ocr/lang',
  });
  const { data } = await (await worker).recognize(imageUri);
  return data.text;
}
