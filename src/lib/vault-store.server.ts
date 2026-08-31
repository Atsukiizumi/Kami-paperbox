/**
 * 本机 Node 纸匣（SQLite + 磁盘文件）。
 *
 * 作用：元数据进 `.data/vault/vault.sqlite`，原图进 `.data/vault/files/{站点}/{id}/`。
 * 用法：只在服务端 import。HTTP 见 `/api/vault`。测试可 openVaultStore(临时目录)。
 * 为什么：
 *   - IndexedDB 有配额、清站点数据就没了，量大以后也不好查。
 *   - 用户选的文件夹不能 SQL 查询，所以目录必须在程序自己的库里。
 *   - 用 Node 22 自带的 `node:sqlite`，不必编译 better-sqlite3。
 *   - Vercel 不能写磁盘：mkdir 失败就当不可用，浏览器回退 IndexedDB。
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKamiRoot } from "./proxy.server.ts";
import { isSource } from "./sites.ts";
import type { Source, VaultMeta } from "./types.ts";
import { filterVaultItems, vaultAuthors, vaultTotals, type VaultQuery } from "./vault-query.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS works (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  author_id TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  page_count INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  relative_path TEXT,
  folder_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_works_source ON works(source);
CREATE INDEX IF NOT EXISTS idx_works_author ON works(author);
CREATE INDEX IF NOT EXISTS idx_works_saved ON works(saved_at);
CREATE TABLE IF NOT EXISTS pages (
  key TEXT NOT NULL,
  page INTEGER NOT NULL,
  ext TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (key, page)
);
`;

export type VaultPageFile = {
  bytes: Uint8Array;
  ext: string;
  mime: string;
};

export type VaultPageRead = {
  bytes: Buffer;
  ext: string;
  mime: string;
};

type WorkRow = {
  key: string;
  source: string;
  id: string;
  title: string;
  author: string;
  author_id: string;
  tags: string;
  page_count: number;
  saved_at: number;
  bytes: number;
  relative_path: string | null;
  folder_label: string | null;
};

export function parseVaultKey(raw: string): { source: Source; id: string } | null {
  const cut = raw.indexOf(":");
  if (cut <= 0) return null;
  const source = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (!isSource(source)) return null;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return null;
  return { source, id };
}

function safeSeg(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "x";
}

function tagsJson(tags: string[]): string {
  return JSON.stringify(tags.slice(0, 80));
}

function tagsOf(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((t): t is string => typeof t === "string").slice(0, 80);
  } catch {
    return [];
  }
}

export function rowToMeta(row: WorkRow): VaultMeta {
  return {
    key: row.key,
    source: row.source as Source,
    id: row.id,
    title: row.title,
    author: row.author,
    authorId: row.author_id,
    tags: tagsOf(row.tags),
    pageCount: Number(row.page_count) || 0,
    savedAt: Number(row.saved_at) || 0,
    bytes: Number(row.bytes) || 0,
    relativePath: row.relative_path || undefined,
    folderLabel: row.folder_label || undefined,
  };
}

export type VaultStore = {
  dir: string;
  put: (meta: VaultMeta, pages: VaultPageFile[]) => VaultMeta;
  list: (q?: VaultQuery) => VaultMeta[];
  get: (key: string) => VaultMeta | undefined;
  readPage: (key: string, page: number) => VaultPageRead | undefined;
  patch: (key: string, patch: Partial<Pick<VaultMeta, "relativePath" | "folderLabel" | "title">>) => VaultMeta | undefined;
  remove: (key: string) => boolean;
  authors: () => string[];
  stats: () => { count: number; bytes: number; dir: string };
  close: () => void;
};

export function openVaultStore(root = resolveKamiRoot()): VaultStore {
  const dir = join(root, ".data", "vault");
  const filesDir = join(dir, "files");
  mkdirSync(filesDir, { recursive: true });
  const db = new DatabaseSync(join(dir, "vault.sqlite"));
  db.exec(SCHEMA);

  const selectWork = db.prepare("SELECT * FROM works WHERE key = ?");
  const selectWorks = db.prepare("SELECT * FROM works ORDER BY saved_at DESC");
  const upsertWork = db.prepare(
    `INSERT INTO works (key, source, id, title, author, author_id, tags, page_count, saved_at, bytes, relative_path, folder_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       source=excluded.source, id=excluded.id, title=excluded.title, author=excluded.author,
       author_id=excluded.author_id, tags=excluded.tags, page_count=excluded.page_count,
       saved_at=excluded.saved_at, bytes=excluded.bytes, relative_path=excluded.relative_path,
       folder_label=excluded.folder_label`,
  );
  const deleteWork = db.prepare("DELETE FROM works WHERE key = ?");
  const deletePages = db.prepare("DELETE FROM pages WHERE key = ?");
  const insertPage = db.prepare(
    "INSERT INTO pages (key, page, ext, mime, bytes, path) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const selectPage = db.prepare("SELECT ext, mime, bytes, path FROM pages WHERE key = ? AND page = ?");
  const selectPages = db.prepare("SELECT path FROM pages WHERE key = ?");

  function workDir(source: string, id: string) {
    return join(filesDir, safeSeg(source), safeSeg(id));
  }

  function dropFiles(key: string) {
    const rows = selectPages.all(key) as { path: string }[];
    for (const row of rows) {
      try {
        rmSync(join(dir, ...row.path.split("/")), { force: true });
      } catch {
        /* leftover */
      }
    }
    deletePages.run(key);
  }

  const store: VaultStore = {
    dir,
    put(meta, pages) {
      const parsed = parseVaultKey(meta.key) ?? parseVaultKey(`${meta.source}:${meta.id}`);
      if (!parsed) throw new Error("无效的作品编号");
      const key = `${parsed.source}:${parsed.id}`;
      const at = meta.savedAt || Date.now();
      dropFiles(key);
      const dest = workDir(parsed.source, parsed.id);
      mkdirSync(dest, { recursive: true });
      let bytes = 0;
      pages.forEach((page, i) => {
        const ext = (page.ext || "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
        const rel = `files/${safeSeg(parsed.source)}/${safeSeg(parsed.id)}/${i}.${ext}`;
        writeFileSync(join(dir, ...rel.split("/")), page.bytes);
        bytes += page.bytes.byteLength;
        insertPage.run(key, i, ext, page.mime || "application/octet-stream", page.bytes.byteLength, rel);
      });
      upsertWork.run(
        key,
        parsed.source,
        parsed.id,
        meta.title || "无题",
        meta.author || "",
        meta.authorId || "",
        tagsJson(meta.tags || []),
        pages.length,
        at,
        bytes,
        meta.relativePath ?? null,
        meta.folderLabel ?? null,
      );
      return store.get(key) as VaultMeta;
    },
    list(q) {
      const rows = selectWorks.all() as WorkRow[];
      const items = rows.map(rowToMeta);
      return filterVaultItems(items, q ?? {});
    },
    get(key) {
      const row = selectWork.get(key) as WorkRow | undefined;
      return row ? rowToMeta(row) : undefined;
    },
    readPage(key, page) {
      const row = selectPage.get(key, page) as { ext: string; mime: string; bytes: number; path: string } | undefined;
      if (!row) return undefined;
      const abs = join(dir, ...row.path.split("/"));
      if (!existsSync(abs)) return undefined;
      return { bytes: readFileSync(abs), ext: row.ext, mime: row.mime };
    },
    patch(key, patch) {
      const current = store.get(key);
      if (!current) return undefined;
      const next: VaultMeta = {
        ...current,
        title: patch.title ?? current.title,
        relativePath: patch.relativePath ?? current.relativePath,
        folderLabel: patch.folderLabel ?? current.folderLabel,
      };
      upsertWork.run(
        next.key,
        next.source,
        next.id,
        next.title,
        next.author,
        next.authorId,
        tagsJson(next.tags),
        next.pageCount,
        next.savedAt,
        next.bytes,
        next.relativePath ?? null,
        next.folderLabel ?? null,
      );
      return next;
    },
    remove(key) {
      if (!store.get(key)) return false;
      dropFiles(key);
      deleteWork.run(key);
      const parsed = parseVaultKey(key);
      if (parsed) {
        try {
          rmSync(workDir(parsed.source, parsed.id), { recursive: true, force: true });
        } catch {
          /* empty */
        }
      }
      return true;
    },
    authors() {
      return vaultAuthors(store.list());
    },
    stats() {
      const items = store.list();
      return { ...vaultTotals(items), dir };
    },
    close() {
      db.close();
    },
  };
  return store;
}

let singleton: VaultStore | null = null;

export function getVaultStore(): VaultStore {
  singleton ??= openVaultStore();
  return singleton;
}

export function vaultStoreHealth(): { available: boolean; count: number; bytes: number; dir: string } {
  try {
    const stats = getVaultStore().stats();
    return { available: true, ...stats };
  } catch {
    return { available: false, count: 0, bytes: 0, dir: "" };
  }
}
