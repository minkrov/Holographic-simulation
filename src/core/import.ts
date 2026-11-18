import { stamp, uid, mmValue, type Revision, type Units } from './domain';
import { readVisual, disposeModel, describeVisual } from '../scene/model';
import { MAX_FILE } from './verify';

export interface ImportOptions {
  file: File;
  units: Units;
  up: 'y' | 'z';
  confirmed: boolean;
  source: string;
  author: string;
  license: string;
}
interface Checked {
  bytes: ArrayBuffer;
  stats: { triangles: number };
  warnings: string[];
}

export function checkModel(
  bytes: ArrayBuffer,
  format: 'glb' | 'stl',
  signal: AbortSignal,
): Promise<Checked> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./validate.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new Error('Could not start the model validation worker.'));
      return;
    }
    function finish() {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
    function abort() {
      finish();
      reject(signal.reason);
    }
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error('Validation timed out. Try a smaller model.'));
    }, 20_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Checked & { ok: boolean; error?: string }>) => {
      finish();
      if (data.ok) resolve(data);
      else reject(new Error(data.error || 'Validation failed.'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Could not validate this file in the model worker.'));
    };
    worker.postMessage({ bytes, format }, [bytes]);
  });
}

export async function prepareImport(
  options: ImportOptions,
  signal: AbortSignal,
  stage: (message: string) => void,
) {
  const { file } = options;
  const ext = file.name.split('.').at(-1)?.toLowerCase();
  if (ext !== 'glb' && ext !== 'stl') throw new Error('Choose a self-contained .glb or an .stl file.');
  if (!file.size || file.size > MAX_FILE) throw new Error('Choose a nonempty model under 75 MiB.');
  stage('Validating model');
  const checked = await checkModel(await file.arrayBuffer(), ext, signal);
  signal.throwIfAborted();
  stage('Reading parts and scale');
  const key = globalThis.crypto?.subtle
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', checked.bytes)))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
    : uid();
  const revision: Revision = {
    id: uid(),
    label: 'r01',
    fileName: file.name.slice(0, 180),
    format: ext,
    key,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    parts: [],
    triangles: checked.stats.triangles,
    confirmed: options.confirmed,
    multiplier: ext === 'glb' ? 1 : mmValue(1, options.units) / 1000,
    up: ext === 'stl' ? options.up : 'y',
    imported: stamp(),
    source: options.source.trim().slice(0, 300) || undefined,
    author: options.author.trim().slice(0, 100) || undefined,
    license: options.license.trim().slice(0, 100) || undefined,
    warnings: checked.warnings,
  };
  const visual = await readVisual(revision, checked.bytes);
  try {
    signal.throwIfAborted();
    const meta = describeVisual(visual);
    revision.bounds = meta.bounds;
    revision.parts = meta.parts;
  } finally {
    disposeModel(visual);
  }
  return { revision, file: { key, blob: file } };
}
