/**
 * PGLite 内存库的 JSON 快照。
 *
 * 作用：把应用账号体系里「丢了就麻烦」的表整表存成 `.data/kami-db-snapshot.json`，
 *      启动时恢复回内存库。
 * 用法：db.ts 初始化后调 restoreSnapshotThenWatch()；登录路由和同步路由在写操作后
 *      调 scheduleSnapshotDump() 立刻落一份。
 * 为什么：PGlite 的 dataDir 落盘在进程被强杀后可能整体损坏、重开直接 Abort
 *        （electric-sql/pglite#327），Windows 关终端就是强杀。快照是普通 JSON 文件，
 *        永远能读；会话表也带上，重启后浏览器 Cookie 仍然有效，不用重新登录。
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKamiRoot } from "./proxy.server.ts";
import { getSql, type Sql } from "./db";

/** 快照覆盖的表：账号（user/account）、会话（session）、账号同步（user_sync）。 */
const TABLES = ["user", "account", "session", "user_sync"] as const;
/** 这些列是 jsonb：恢复时要带 ::jsonb 转换。 */
const JSONB_COLUMNS = new Set(["payload"]);
const WATCH_INTERVAL_MS = 30_000;

type Snapshot = { at: number; tables: Record<string, Record<string, unknown>[]> };

function snapshotPath() {
  return join(resolveKamiRoot(), ".data", "kami-db-snapshot.json");
}

const globalRef = globalThis as typeof globalThis & {
  __kamiSnapshotTimer__?: ReturnType<typeof setInterval>;
  __kamiSnapshotLast__?: string;
  __kamiSnapshotDumpQueued__?: boolean;
};

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, "")}"`;
}

export function readSnapshotFile(): Snapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath(), "utf8")) as Snapshot;
    if (!parsed || typeof parsed !== "object" || !parsed.tables) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 把快照行写回（刚迁移完的）内存库。列名来自快照本身，值按 jsonb 列转换。 */
async function restore(sql: Sql, snap: Snapshot) {
  for (const table of TABLES) {
    const rows = snap.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => row[c] !== null && row[c] !== undefined);
      if (!cols.length) continue;
      const params: unknown[] = [];
      const marks = cols.map((c) => {
        params.push(JSONB_COLUMNS.has(c) ? JSON.stringify(row[c]) : row[c]);
        return JSONB_COLUMNS.has(c) ? `$${params.length}::jsonb` : `$${params.length}`;
      });
      try {
        await sql.query(
          `insert into ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) values (${marks.join(", ")}) on conflict do nothing`,
          params,
        );
      } catch (err) {
        console.warn(`[db-snapshot] 恢复 ${table} 一行失败（跳过）：`, err instanceof Error ? err.message : err);
      }
    }
  }
}

/** 全量导出四张表。任何一步出错返回 null（宁可重新注册，不要把服务拖死）。 */
async function capture(sql: Sql): Promise<Snapshot | null> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  try {
    for (const table of TABLES) {
      tables[table] = await sql.query<Record<string, unknown>>(`select * from ${quoteIdent(table)}`);
    }
    return { at: Date.now(), tables };
  } catch {
    return null;
  }
}

async function dumpNow() {
  try {
    const sql = await getSql();
    const snap = await capture(sql);
    if (!snap) return;
    const text = JSON.stringify(snap);
    if (text === globalRef.__kamiSnapshotLast__) return;
    const path = snapshotPath();
    writeFileSync(`${path}.tmp`, text, "utf8");
    renameSync(`${path}.tmp`, path);
    globalRef.__kamiSnapshotLast__ = text;
  } catch (err) {
    console.warn("[db-snapshot] 落盘失败（下个周期再试）：", err instanceof Error ? err.message : err);
  }
}

/** 写操作后调用：500ms 内合并成一次落盘。 */
export function scheduleSnapshotDump() {
  if (globalRef.__kamiSnapshotDumpQueued__) return;
  globalRef.__kamiSnapshotDumpQueued__ = true;
  setTimeout(() => {
    globalRef.__kamiSnapshotDumpQueued__ = false;
    void dumpNow();
  }, 500).unref?.();
}

/**
 * 启动时恢复快照，然后开 30s 的看护：表内容有变就自动落一份。
 * 在 db 初始化（含迁移）之后调用。
 */
export async function restoreSnapshotThenWatch() {
  const sql = await getSql();
  const snap = readSnapshotFile();
  if (snap) {
    await restore(sql, snap);
    console.log(`[db-snapshot] 已从快照恢复（${Object.entries(snap.tables).map(([t, r]) => `${t}:${r.length}`).join(" ")}）`);
  }
  await dumpNow();
  if (!globalRef.__kamiSnapshotTimer__) {
    globalRef.__kamiSnapshotTimer__ = setInterval(() => void dumpNow(), WATCH_INTERVAL_MS);
    globalRef.__kamiSnapshotTimer__.unref?.();
  }
}
