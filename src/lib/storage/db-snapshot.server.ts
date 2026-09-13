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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveKamiRoot } from "../proxy.server.ts";
import { getSql, type Sql } from "./db.ts";

/**
 * 快照覆盖的表：public 下除 _migrations 外的全部基表，启动时动态枚举。
 * （曾用硬编码清单，0003 加 user_sync_segments/user_sync_meta 时漏掉导致
 * PGlite 重启丢分段同步数据，TD-19；全量枚举让新表自动纳入。）
 */
async function snapshotTables(sql: Sql): Promise<string[]> {
  const rows = await sql.query<{ table_name: string }>(
    "select table_name from information_schema.tables " +
      "where table_schema = 'public' and table_type = 'BASE TABLE' " +
      "and table_name <> '_migrations' order by table_name",
  );
  return rows.map((r) => r.table_name);
}

/** 这些列是 jsonb：恢复时要带 ::jsonb 转换。 */
const JSONB_COLUMNS = new Set(["payload"]);
const WATCH_INTERVAL_MS = 30_000;

export type Snapshot = { at: number; tables: Record<string, Record<string, unknown>[]> };

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
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn("[db-snapshot:read] 快照存在但读取失败（视为无快照）：", err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/**
 * 恢复顺序：FK 父表在前。快照表按字母序存（account/session 排在 user 前），
 * 先插子表会被外键拒掉、行被 try/catch 吞掉——重启丢登录态。
 * 依据 information_schema 的 FK 边做拓扑排序；查不到 FK 信息或有环时按快照原序兜底。
 */
async function restoreOrder(sql: Sql, tables: string[]): Promise<string[]> {
  if (tables.length < 2) return tables;
  let edges: { tbl: string; ref: string }[] = [];
  try {
    edges = await sql.query<{ tbl: string; ref: string }>(
      "select tc.table_name as tbl, ccu.table_name as ref " +
        "from information_schema.table_constraints tc " +
        "join information_schema.constraint_column_usage ccu " +
        "  on ccu.constraint_name = tc.constraint_name " +
        " and ccu.table_schema = tc.constraint_schema " +
        "where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'",
    );
  } catch (err) {
    console.warn("[db-snapshot:fk-edges] FK 信息查询失败，按快照原序恢复：", err instanceof Error ? err.message : err);
    return tables;
  }
  const inSnap = new Set(tables);
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { tbl, ref } of edges) {
    if (deps.has(tbl) && inSnap.has(ref)) deps.get(tbl)!.add(ref);
  }
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...deps.get(t)!].every((d) => done.has(d)));
    if (!ready.length) {
      out.push(...tables.filter((t) => !done.has(t))); // FK 成环：剩余按原序兜底
      break;
    }
    for (const t of ready) {
      out.push(t);
      done.add(t);
    }
  }
  return out;
}

/** 单行恢复失败：restore 结束后仍插不回去的行（TD-22：收集而非静默吞）。 */
export type RestoreFailure = { table: string; row: Record<string, unknown>; error: string };

async function insertRow(sql: Sql, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row).filter((c) => row[c] !== null && row[c] !== undefined);
  if (!cols.length) return;
  const params: unknown[] = [];
  const marks = cols.map((c) => {
    params.push(JSONB_COLUMNS.has(c) ? JSON.stringify(row[c]) : row[c]);
    return JSONB_COLUMNS.has(c) ? `$${params.length}::jsonb` : `$${params.length}`;
  });
  await sql.query(
    `insert into ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) values (${marks.join(", ")}) on conflict do nothing`,
    params,
  );
}

/**
 * 把快照行写回（刚迁移完的）内存库。列名来自快照本身，值按 jsonb 列转换。
 * 返回重试一轮后仍失败的行（TD-22：此前单行失败只 warn 跳过、随后即被
 * dumpNow 覆盖快照——失败行就这么静默没了，可能是 session/账号行）。
 * 重试兜的是「子表先于父表」之外的次序问题（如同表内自引用、FK 成环兜底序）。
 */
export async function restore(sql: Sql, snap: Snapshot): Promise<RestoreFailure[]> {
  let pending: RestoreFailure[] = [];
  const runPass = async (rows: RestoreFailure[]): Promise<RestoreFailure[]> => {
    const failed: RestoreFailure[] = [];
    for (const item of rows) {
      try {
        await insertRow(sql, item.table, item.row);
      } catch (err) {
        failed.push({ ...item, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return failed;
  };
  for (const table of await restoreOrder(sql, Object.keys(snap.tables))) {
    const rows = snap.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const failed = await runPass(rows.map((row) => ({ table, row, error: "" })));
    pending = [...pending, ...failed];
  }
  if (pending.length) {
    console.warn(`[db-snapshot:restore] 首轮 ${pending.length} 行失败，重试一轮：`, pending.map((f) => f.table).join(" "));
    pending = await runPass(pending);
  }
  return pending;
}

/** 全量导出所有业务表。任何一步出错返回 null（宁可重新注册，不要把服务拖死）。 */
export async function capture(sql: Sql): Promise<Snapshot | null> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  try {
    for (const table of await snapshotTables(sql)) {
      tables[table] = await sql.query<Record<string, unknown>>(`select * from ${quoteIdent(table)}`);
    }
    return { at: Date.now(), tables };
  } catch (err) {
    console.warn("[db-snapshot:capture] 导出失败（本周期跳过）：", err instanceof Error ? err.message : err);
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
    mkdirSync(dirname(path), { recursive: true });
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
 * 恢复仍失败的行隔离落盘（TD-22）：主快照随后会被 dumpNow 覆盖（否则新写入
 * 永不落盘），被隔离行在这里原样留存——凭据/会话行永不静默销毁，由人处置。
 */
function quarantineRestoreFailures(failures: RestoreFailure[]) {
  try {
    const path = join(resolveKamiRoot(), ".data", "kami-db-snapshot.restore-failed.json");
    const text = JSON.stringify({ at: Date.now(), rows: failures }, null, 2);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, text, "utf8");
    renameSync(`${path}.tmp`, path);
  } catch (err) {
    console.warn(
      "[db-snapshot:quarantine] 失败行隔离落盘失败（行将丢失）：",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 启动时恢复快照，然后开 30s 的看护：表内容有变就自动落一份。
 * 在 db 初始化（含迁移）之后调用。
 */
export async function restoreSnapshotThenWatch() {
  const sql = await getSql();
  const snap = readSnapshotFile();
  if (snap) {
    const failures = await restore(sql, snap);
    if (failures.length) {
      const byTable = new Map<string, number>();
      for (const f of failures) byTable.set(f.table, (byTable.get(f.table) ?? 0) + 1);
      console.warn(
        `[db-snapshot:restore] ${failures.length} 行两轮恢复仍失败，已隔离到 .data/kami-db-snapshot.restore-failed.json：`,
        [...byTable].map(([t, n]) => `${t}×${n}`).join(" "),
      );
      quarantineRestoreFailures(failures);
    }
    console.log(`[db-snapshot] 已从快照恢复（${Object.entries(snap.tables).map(([t, r]) => `${t}:${r.length}`).join(" ")}）`);
  }
  await dumpNow();
  if (!globalRef.__kamiSnapshotTimer__) {
    globalRef.__kamiSnapshotTimer__ = setInterval(() => void dumpNow(), WATCH_INTERVAL_MS);
    globalRef.__kamiSnapshotTimer__.unref?.();
  }
}
