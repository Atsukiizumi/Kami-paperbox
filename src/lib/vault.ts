/**
 * 纸匣存储（IndexedDB `kami-vault`）。
 *
 * 作用：把收入纸匣的作品元数据和原图像素存在本机浏览器里，刷新、关掉标签页都还在。
 * 用法：
 *   - saveVaultWork(work, pages) 写入 meta + blobs
 *   - listVault() 按时间倒序列出
 *   - getVaultBlob(key, page) 取某一页
 *   - patchVaultMeta(key, { relativePath }) 把磁盘相对路径记到目录上
 *   - 查询（标题/作者/标签/路径）见 vault-query.ts，不要在这里做过滤
 * 为什么用 IndexedDB 而不是只靠 SQLite：
 *   图是 Blob，浏览器里要能立刻预览；Node 关掉时 PWA 还得能看缓存。
 *   真正扛量和可查询的目录在服务端 vault-store.server.ts（`.data/vault`）。
 *   磁盘用户文件夹自己不能搜，所以 meta 里记下 relativePath。
 */
import type { VaultMeta, WorkDetail, WorkPage } from "./types";
import { deleteServerVault, fetchServerVaultBlob } from "./vault-sync";

export type { VaultMeta } from "./types";

const DB_NAME = "kami-vault";
const VERSION = 2;

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
      const meta = req.transaction?.objectStore("meta");
      if (meta && !meta.indexNames.contains("bySource")) meta.createIndex("bySource", "source", { unique: false });
      if (meta && !meta.indexNames.contains("byAuthor")) meta.createIndex("byAuthor", "author", { unique: false });
      if (meta && !meta.indexNames.contains("bySavedAt")) meta.createIndex("bySavedAt", "savedAt", { unique: false });
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
  const local = (await reqToPromise(tx.objectStore("blobs").get(`${key}#${page}`))) as Blob | undefined;
  if (local) return local;
  return fetchServerVaultBlob(key, page);
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

export async function patchVaultMeta(key: string, patch: Partial<VaultMeta>): Promise<void> {
  const current = await getVaultMeta(key);
  if (!current) return;
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ ...current, ...patch, key });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
  await deleteServerVault(key);
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
