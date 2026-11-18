import { uid, type Workspace } from './domain';

const DB = 'orion-workbench';
const KEY = 'workspace';
const CHECKPOINT = 'checkpoint';
export type StorageStatus = 'saved' | 'memory' | 'conflict';
let database: Promise<IDBDatabase> | undefined;
let fallback: Workspace | undefined;
let checkpoint: string | undefined;
let readOnly = false;
let newerTab = false;
let queue = Promise.resolve<StorageStatus>('saved');
const files = new Map<string, Blob>();

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Browser storage is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close old Orion tabs to unlock browser storage.'));
  }));
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readWorkspace(): Promise<{ value?: Workspace; available: boolean }> {
  try {
    const store = (await open()).transaction('state', 'readonly').objectStore('state');
    const [value, version] = await Promise.all([
      result<Workspace | undefined>(store.get(KEY)),
      result<string | undefined>(store.get(CHECKPOINT)),
    ]);
    if (
      value &&
      (value.schema !== 1 ||
        !Array.isArray(value.projects) ||
        !value.projects.length ||
        !value.sessions ||
        !value.preferences)
    ) {
      readOnly = true;
      return { value: fallback, available: false };
    }
    checkpoint = version;
    return { value: value ?? fallback, available: true };
  } catch {
    return { value: fallback, available: false };
  }
}
export async function readBytes(key: string): Promise<ArrayBuffer> {
  let blob = files.get(key);
  if (!blob) {
    try {
      blob = await result((await open()).transaction('files', 'readonly').objectStore('files').get(key));
    } catch {
      /* Session-only storage. */
    }
  }
  if (!blob)
    throw new Error(
      'The source model is unavailable on this browser. Re-import the file to use it here.',
    );
  return blob.arrayBuffer();
}

export function storeWorkspace(
  value: Workspace,
  file?: { key: string; blob: Blob },
): Promise<StorageStatus> {
  fallback = value;
  if (file) files.set(file.key, file.blob);
  // Serialize writes in this tab. If an earlier blob write failed, retry that blob
  // with the next state that references it, never commit metadata alone.
  queue = queue.then(async () => {
    if (readOnly) return 'memory';
    if (newerTab) return 'conflict';
    const pending = new Map<string, Blob>();
    if (files.size)
      for (const project of value.projects)
        for (const revisionSet of [project, ...project.undo]) {
          for (const asset of revisionSet.assets)
            for (const revision of asset.revisions) {
              const blob = revision.key && files.get(revision.key);
              if (blob) pending.set(revision.key!, blob);
            }
        }
    try {
      const db = await open(),
        next = uid();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(pending.size ? ['state', 'files'] : ['state'], 'readwrite');
        const state = tx.objectStore('state');
        const compare = state.get(CHECKPOINT);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
        compare.onsuccess = () => {
          if (compare.result !== checkpoint) {
            newerTab = true;
            tx.abort();
            return;
          }
          if (pending.size) {
            const originals = tx.objectStore('files');
            for (const [key, blob] of pending) originals.put(blob, key);
          }
          state.put(value, KEY);
          state.put(next, CHECKPOINT);
        };
      });
      checkpoint = next;
      for (const [key, blob] of pending) if (files.get(key) === blob) files.delete(key);
      return 'saved';
    } catch {
      return newerTab ? 'conflict' : 'memory';
    }
  });
  return queue;
}

export function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function fileStem(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'orion-review'
  );
}
