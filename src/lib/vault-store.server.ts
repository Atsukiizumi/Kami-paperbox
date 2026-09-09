/**
 * 本机 Node 纸匣（SQLite + 磁盘文件）。
 *
 * 作用：元数据进 `.data/vault/vault.sqlite`，原图进 `.data/vault/files/{站点}/{id}/`。
 * 用法：只在服务端 import。HTTP 见 `/api/vault`。测试可 openVaultStore(临时目录)。
 * 为什么：
 *   - IndexedDB 有配额、清站点数据就没了，量大以后也不好查。
 *   - 用户选的文件夹不能 SQL 查询，所以目录必须在程序自己的库里。
 *   - 用 Node 22 自带的 `node:sqlite`，不必编 better-sqlite3，也不上图数据库。
 *     作者/标签是作品上的字段；真要走「相关作品」再加边表即可。
 *   - 原图是普通 jpg/png/gif 文件，不把像素塞进 SQLite。
 *   - Vercel 不能写磁盘：mkdir 失败就当不可用，浏览器回退 IndexedDB。
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync, existsSync } from "node:fs";
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
  // 不含点号：各站作品 id 均为字母数字（含 _ -），点号只给 `..` 上爬留门（SEC-10）。
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return { source, id };
}

function safeSeg(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "x";
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

export function rowToMeta(row: WorkRow, hasFile = false): VaultMeta {
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
    hasFile,
  };
}

export type VaultStore = {
  dir: string;
  put: (meta: VaultMeta, pages: VaultPageFile[]) => VaultMeta;
  putMeta: (meta: VaultMeta) => VaultMeta;
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
  const selectPageKeys = db.prepare("SELECT DISTINCT key FROM pages");
  const selectHasPage = db.prepare("SELECT 1 AS ok FROM pages WHERE key = ? AND page = 0 LIMIT 1");

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

  /** 清掉崩溃残留的半成品暂存（put 开始时自愈，无需启动钩子）。 */
  function sweepStaged(dest: string) {
    try {
      for (const name of readdirSync(dest)) {
        if (name.startsWith(".") && name.endsWith(".tmp")) {
          try {
            rmSync(join(dest, name), { force: true });
          } catch {
            /* 单个清不掉不阻塞 */
          }
        }
      }
    } catch {
      /* 目录不存在 */
    }
  }

  const store: VaultStore = {
    dir,
    put(meta, pages) {
      const parsed = parseVaultKey(meta.key) ?? parseVaultKey(`${meta.source}:${meta.id}`);
      if (!parsed) throw new Error("无效的作品编号");
      const key = `${parsed.source}:${parsed.id}`;
      const at = meta.savedAt || Date.now();
      const dest = workDir(parsed.source, parsed.id);
      mkdirSync(dest, { recursive: true });
      sweepStaged(dest);

      // TD-08：先全部写同目录暂存（rename 原子替换，跨次不会见半文件）；
      // 任一失败即清理退出——旧文件、旧行原样保留，不出现「删旧后写新到一半」。
      const staged: { tmp: string; rel: string }[] = [];
      try {
        pages.forEach((page, i) => {
          const ext = (page.ext || "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
          const rel = `files/${safeSeg(parsed.source)}/${safeSeg(parsed.id)}/${i}.${ext}`;
          const abs = join(dir, ...rel.split("/"));
          const tmp = join(dest, `.${i}.${ext}.tmp`);
          writeFileSync(tmp, page.bytes);
          staged.push({ tmp, rel });
        });
      } catch (err) {
        for (const s of staged) {
          try {
            rmSync(s.tmp, { force: true });
          } catch {
            /* 清不掉的留给 sweepStaged */
          }
        }
        throw err;
      }

      dropFiles(key);
      let bytes = 0;
      staged.forEach((s, i) => {
        renameSync(s.tmp, join(dir, ...s.rel.split("/")));
        bytes += pages[i]!.bytes.byteLength;
      });

      // 页行 + 目录行同一事务：要么整份可见，要么整份回滚。
      try {
        db.exec("BEGIN IMMEDIATE");
        deletePages.run(key);
        staged.forEach((s, i) => {
          const ext = (pages[i]!.ext || "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
          insertPage.run(key, i, ext, pages[i]!.mime || "application/octet-stream", pages[i]!.bytes.byteLength, s.rel);
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
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return store.get(key) as VaultMeta;
    },
    putMeta(meta) {
      const parsed = parseVaultKey(meta.key) ?? parseVaultKey(`${meta.source}:${meta.id}`);
      if (!parsed) throw new Error("无效的作品编号");
      const key = `${parsed.source}:${parsed.id}`;
      const prev = store.get(key);
      const at = meta.savedAt || prev?.savedAt || Date.now();
      upsertWork.run(
        key,
        parsed.source,
        parsed.id,
        meta.title || prev?.title || "无题",
        meta.author || prev?.author || "",
        meta.authorId || prev?.authorId || "",
        tagsJson(meta.tags?.length ? meta.tags : prev?.tags || []),
        meta.pageCount || prev?.pageCount || 0,
        at,
        meta.bytes || prev?.bytes || 0,
        meta.relativePath ?? prev?.relativePath ?? null,
        meta.folderLabel ?? prev?.folderLabel ?? null,
      );
      return store.get(key) as VaultMeta;
    },
    list(q) {
      const rows = selectWorks.all() as WorkRow[];
      const stored = new Set((selectPageKeys.all() as { key: string }[]).map((row) => row.key));
      const items = rows.map((row) => rowToMeta(row, stored.has(row.key)));
      return filterVaultItems(items, q ?? {});
    },
    get(key) {
      const row = selectWork.get(key) as WorkRow | undefined;
      if (!row) return undefined;
      return rowToMeta(row, Boolean(selectHasPage.get(key)));
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
