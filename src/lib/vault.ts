import type { VaultMeta, WorkDetail, WorkPage } from "./types";

export type { VaultMeta } from "./types";

const DB_NAME = "kami-vault";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function workKey(source: string, id: string): string {
  return `${source}:${id}`;
}

export async function listVault(): Promise<VaultMeta[]> {
  const db = await openDb();
  const tx = db.transaction("meta", "readonly");
  const rows = await reqToPromise(tx.objectStore("meta").getAll());
  return (rows as VaultMeta[]).sort((a, b) => b.savedAt - a.savedAt);
}

export async function getVaultMeta(key: string): Promise<VaultMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction("meta", "readonly");
  return (await reqToPromise(tx.objectStore("meta").get(key))) as VaultMeta | undefined;
}

export async function getVaultBlob(key: string, page: number): Promise<Blob | undefined> {
  const db = await openDb();
  const tx = db.transaction("blobs", "readonly");
  return (await reqToPromise(tx.objectStore("blobs").get(`${key}#${page}`))) as Blob | undefined;
}

export async function saveVaultWork(
  work: WorkDetail,
  pages: { blob: Blob; page: WorkPage }[],
): Promise<VaultMeta> {
  const key = workKey(work.source, work.id);
  const bytes = pages.reduce((n, p) => n + p.blob.size, 0);
  const meta: VaultMeta = {
    key,
    source: work.source,
    id: work.id,
    title: work.title,
    author: work.author,
    authorId: work.authorId,
    tags: work.tags,
    pageCount: pages.length,
    savedAt: Date.now(),
    bytes,
  };
  const db = await openDb();
  const tx = db.transaction(["meta", "blobs"], "readwrite");
  tx.objectStore("meta").put(meta);
  const blobs = tx.objectStore("blobs");
  pages.forEach((p, i) => blobs.put(p.blob, `${key}#${i}`));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return meta;
}

export async function deleteVaultWork(key: string): Promise<void> {
  const meta = await getVaultMeta(key);
  const db = await openDb();
  const tx = db.transaction(["meta", "blobs"], "readwrite");
  tx.objectStore("meta").delete(key);
  const blobs = tx.objectStore("blobs");
  const count = meta?.pageCount ?? 24;
  for (let i = 0; i < count; i += 1) blobs.delete(`${key}#${i}`);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function requestVaultPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function vaultStorageEstimate(): Promise<{
  persisted: boolean;
  usage: number;
  quota: number;
}> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return { persisted: false, usage: 0, quota: 0 };
  }
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  const estimate = await navigator.storage.estimate?.();
  return {
    persisted,
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
  };
}
