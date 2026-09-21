/**
 * 本机下载文件夹（File System Access API）。
 *
 * 作用：记住用户选的 DirectoryHandle，按相对路径写入或读回文件。
 * 用法：pickDownloadFolder() 一次；之后 writeRelativeFile / readRelativeFile。
 * 为什么：handle 不能放 localStorage，只能放 IndexedDB。权限每次会话可能要再授权。
 */
const DB_NAME = "kami-folder";
const STORE = "handles";
const KEY = "download";

let cached: FileSystemDirectoryHandle | null | undefined;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
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

export function canPickFolder(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function getFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cached !== undefined) return cached;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const handle = (await reqToPromise(tx.objectStore(STORE).get(KEY))) as
      | FileSystemDirectoryHandle
      | undefined;
    cached = handle ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(handle, KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  cached = handle;
}

export async function clearFolderHandle(): Promise<void> {
  cached = null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function pickDownloadFolder(): Promise<FileSystemDirectoryHandle> {
  if (!canPickFolder()) {
    throw new Error("当前窗口不能选择文件夹。请用 Chrome 或 Edge 在本机打开。");
  }
  const handle = await window.showDirectoryPicker({
    id: "kami-paperbox",
    mode: "readwrite",
    startIn: "downloads",
  });
  await saveFolderHandle(handle);
  return handle;
}

export async function folderPermissionState(): Promise<"granted" | "prompt" | "denied" | "none"> {
  const dir = await getFolderHandle();
  if (!dir) return "none";
  try {
    const q = await dir.queryPermission({ mode: "readwrite" });
    if (q === "granted" || q === "denied" || q === "prompt") return q;
  } catch {
    /* ignore */
  }
  return "prompt";
}

/**
 * 文件夹健康预检（启动提示用；只 query 不 request，绝不弹授权框）。
 *
 * "ok"          句柄在、权限 granted 且目录可读——下载 / 镜像照常落盘。
 * "none"        没有句柄：设置随账号同步，文件夹授权不跟（换浏览器 / 清站点
 *               数据 / 新设备），用户多半以为还在往原文件夹里存。
 * "prompt"      权限被浏览器重置：前台点保存能补授权，后台队列会静默退回
 *               应用内存储——值得提醒去设置重新选一次。
 * "denied"      用户拒绝过授权。
 * "unreadable"  句柄还在但目录读不出来：文件夹被删除 / 移动 / 盘不在了。
 */
export type FolderHealth = "ok" | "none" | "prompt" | "denied" | "unreadable";

export async function folderHealth(): Promise<FolderHealth> {
  const dir = await getFolderHandle();
  if (!dir) return "none";
  let q: PermissionState = "prompt";
  try {
    q = await dir.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
  if (q === "denied") return "denied";
  if (q !== "granted") return "prompt";
  try {
    // granted 也可能指向已删除的目录（句柄惰性失效）：迭代一次探真实可读性
    const iter = (dir as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await iter.next();
  } catch {
    return "unreadable";
  }
  return "ok";
}

export async function ensureFolderPermission(
  handle?: FileSystemDirectoryHandle | null,
): Promise<FileSystemDirectoryHandle | null> {
  const dir = handle ?? (await getFolderHandle());
  if (!dir) return null;
  const q = await dir.queryPermission({ mode: "readwrite" });
  if (q === "granted") return dir;
  if (q === "prompt") {
    const next = await dir.requestPermission({ mode: "readwrite" });
    if (next === "granted") return dir;
  }
  return null;
}

export async function writeRelativeFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  blob: Blob,
): Promise<void> {
  const parts = relativePath.split("/").filter(Boolean);
  const filename = parts.pop();
  if (!filename) throw new Error("文件名无效");
  if (parts.some((part) => part === "." || part === "..") || filename === "." || filename === "..") {
    throw new Error("路径无效");
  }
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const file = await dir.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export async function readRelativeFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<File | null> {
  const parts = relativePath.split("/").filter(Boolean);
  const filename = parts.pop();
  if (!filename) return null;
  if (parts.some((part) => part === "." || part === "..") || filename === "." || filename === "..") {
    return null;
  }
  try {
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    const file = await dir.getFileHandle(filename);
    return file.getFile();
  } catch {
    return null;
  }
}
