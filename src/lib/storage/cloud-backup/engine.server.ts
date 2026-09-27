/**
 * 云备份引擎：定时补偿、目录快照（VACUUM INTO）、像素增量上云。
 *
 * 作用：连接且显式开启后，按配置间隔把 vault.sqlite 一致性快照 + 页图像素
 *      增量传到云备份根目录（catalog/ + files/ + manifest.json）。
 *      本地删除的文件云端永不自动删（孤儿，只计数报告）——备份系统跟随源
 *      删除是容灾大忌。
 * 用法：只在服务端 import。ensureVaultBackupScheduler() 由 /api/vault 与
 *      /api/vault/cloud-backup 首次命中时惰性启动（10 分钟一档的 tick 里判
 *      到期，连接/开关/间隔改动无需重排定时器）。
 * 为什么：调度模式抄 db-snapshot.server.ts（setInterval + globalRef 防热重载
 *      重挂 + unref）；增量按 path+size+mtime diff——藏品文件落盘即不可变，
 *      全量哈希每轮扫数十 GB 不可接受。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getLogger } from "../../log.server.ts";
import { resolveKamiRoot } from "../../proxy.server.ts";
import { getVaultStore, type VaultStore } from "../vault-store.server.ts";
import {
  backupsDir,
  readBackupState,
  readCloudStored,
  writeBackupState,
  type CloudBackupState,
} from "./config.server.ts";
import { createCloudTarget, type CloudTargetClient } from "./targets.server.ts";

const log = getLogger("vault-backup");

const TICK_MS = 10 * 60 * 1000;
const RETRIES = 3;
const CONCURRENCY = 3;
const MANIFEST = "manifest.json";
const CATALOG_DIR = "catalog";

type Manifest = {
  schemaVersion: 1;
  files: { path: string; size: number; mtime: number }[];
  updatedAt: number;
};

const globalRef = globalThis as typeof globalThis & {
  __kamiVaultBackupTimer__?: ReturnType<typeof setInterval>;
  __kamiVaultBackupRunning__?: boolean;
};

/** 单元测试注入点：替换云目标（内存桩）、根目录与纸匣 store（绝不摸真实库）。 */
export type BackupDeps = {
  target?: CloudTargetClient;
  root?: string;
  store?: VaultStore;
};

export function isVaultBackupRunning(): boolean {
  return globalRef.__kamiVaultBackupRunning__ === true;
}

export function stopVaultBackupScheduler(): void {
  if (globalRef.__kamiVaultBackupTimer__) {
    clearInterval(globalRef.__kamiVaultBackupTimer__);
    globalRef.__kamiVaultBackupTimer__ = undefined;
  }
}

function unsupportedNow(root: string): string | null {
  if (process.env.VERCEL) return "此部署形态（Serverless）不支持云备份";
  try {
    mkdirSync(backupsDir(root), { recursive: true });
    const probe = join(backupsDir(root), ".write-probe");
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return null;
  } catch {
    return "备份目录不可写，云备份停用";
  }
}

/** 惰性启动：幂等；未连接也照起（tick 里判），VERCEL/不可写则停用并记原因。 */
export function ensureVaultBackupScheduler(root?: string): void {
  if (globalRef.__kamiVaultBackupTimer__) return;
  const reason = unsupportedNow(root ?? resolveKamiRoot());
  if (reason) {
    log.warn(reason);
    return;
  }
  globalRef.__kamiVaultBackupTimer__ = setInterval(() => void tick(), TICK_MS);
  globalRef.__kamiVaultBackupTimer__.unref?.();
  void tick();
}

async function tick(): Promise<void> {
  try {
    const stored = readCloudStored();
    if (!stored || !stored.config.enabled || isVaultBackupRunning()) return;
    const state = readBackupState();
    const dueAt = (state.lastOkAt ?? 0) + stored.config.intervalHours * 3_600_000;
    if (Date.now() < dueAt) return;
    await runVaultBackup("auto");
  } catch (err) {
    log.warn("定时备份 tick 失败：", err instanceof Error ? err.message : err);
  }
}

/** VACUUM INTO 出一致性副本：单条 SQL 读事务，不依赖 node:sqlite backup API 面貌。 */
export function vacuumVaultSnapshot(vaultDir: string, dest: string): void {
  const db = new DatabaseSync(join(vaultDir, "vault.sqlite"));
  try {
    db.prepare("VACUUM INTO ?").run(dest);
  } finally {
    db.close();
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  // 带毫秒：连点「立即备份」也不会同名互覆；定宽保证字典序=时间序（轮转删旧靠排序）
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

async function withRetry(fn: () => Promise<void>, what: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`${what} 连试 ${RETRIES} 次仍失败：${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function uploadAll(target: CloudTargetClient, items: { rel: string; bytes: Uint8Array }[], state: CloudBackupState, root?: string): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      await withRetry(() => target.putFile(item.rel, item.bytes), `上传 ${item.rel}`);
      state.done += 1;
      state.bytesDone += item.bytes.byteLength;
      if (state.done % 10 === 0 || state.done === state.total) writeBackupState(state, root);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
}

/**
 * 跑一次云备份。manual 触发无视 enabled 开关（显式动作）；auto 只在开启时跑。
 * 返回给调用方（API）一个简要结果；细节进展都在 state 文件里。
 */
export async function runVaultBackup(
  trigger: "auto" | "manual",
  deps: BackupDeps = {},
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const root = deps.root;
  if (globalRef.__kamiVaultBackupRunning__) return { ok: false, error: "备份正在进行" };
  const stored = readCloudStored(root);
  if (!stored) return { ok: false, error: "尚未连接云存储" };
  if (trigger === "auto" && !stored.config.enabled) return { ok: true, skipped: true };

  const target = deps.target ?? createCloudTarget(stored.target);
  const store = deps.store ?? getVaultStore();
  const state: CloudBackupState = { ...readBackupState(root), running: true, done: 0, total: 0, bytesDone: 0, phase: "catalog" };
  globalRef.__kamiVaultBackupRunning__ = true;
  writeBackupState(state, root);

  try {
    // ① 目录快照：tmp 落盘 → 上传 → 滚动删旧
    const tmpDir = join(backupsDir(root), "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const name = `vault-meta-${stamp()}.sqlite`;
    const tmpPath = join(tmpDir, name);
    vacuumVaultSnapshot(store.dir, tmpPath);
    const bytes = readFileSync(tmpPath);
    rmSync(tmpPath, { force: true });
    await withRetry(() => target.putFile(`${CATALOG_DIR}/${name}`, new Uint8Array(bytes)), `上传 ${name}`);
    const oldOnes = (await target.listDir(CATALOG_DIR)).filter((n) => n !== name).sort().reverse();
    for (const stale of oldOnes.slice(Math.max(0, stored.config.keep - 1))) {
      try {
        await target.deleteFile(`${CATALOG_DIR}/${stale}`);
      } catch {
        /* 删不掉留着，不阻塞 */
      }
    }
    state.snapshots = [name, ...oldOnes].slice(0, stored.config.keep);
    state.phase = "files";
    writeBackupState(state, root);

    // ② 像素增量：catalog（pages 行）驱动，含纸篓条目；盘上已缺的计 miss 跳过
    type Entry = { path: string; size: number; mtime: number };
    const local: Entry[] = [];
    let missing = 0;
    for (const row of store.backupPages()) {
      const abs = join(store.dir, ...row.path.split("/"));
      if (!existsSync(abs)) {
        missing += 1;
        continue;
      }
      const st = statSync(abs);
      local.push({ path: row.path, size: st.size, mtime: st.mtimeMs });
    }
    let remote: Manifest = { schemaVersion: 1, files: [], updatedAt: 0 };
    try {
      remote = { ...(JSON.parse(new TextDecoder().decode(await target.getFile(MANIFEST))) as Manifest), schemaVersion: 1 };
      if (!Array.isArray(remote.files)) remote.files = [];
    } catch {
      /* 首次没有 manifest，从零传 */
    }
    const known = new Map(remote.files.map((f) => [f.path, f]));
    const toUpload = local.filter((f) => {
      const prev = known.get(f.path);
      return !prev || prev.size !== f.size || prev.mtime !== f.mtime;
    });
    state.total = toUpload.length;
    writeBackupState(state, root);
    await uploadAll(
      target,
      toUpload.map((f) => ({ rel: f.path, bytes: readFileSync(join(store.dir, ...f.path.split("/"))) })),
      state,
      root,
    );

    // ③ 孤儿：云端（上一轮 manifest）有、本地登记已没有。只计数，永不自动删。
    const localPaths = new Set(local.map((f) => f.path));
    const orphans = remote.files.filter((f) => !localPaths.has(f.path)).length;

    // ④ 写回 manifest + 收尾
    const next: Manifest = { schemaVersion: 1, files: local, updatedAt: Date.now() };
    state.phase = "manifest";
    writeBackupState(state, root);
    await withRetry(() => target.putFile(MANIFEST, new TextEncoder().encode(JSON.stringify(next))), "上传 manifest");

    state.running = false;
    state.phase = "idle";
    state.lastOkAt = Date.now();
    state.lastErrorAt = null;
    state.lastError = null;
    state.orphans = orphans;
    writeBackupState(state, root);
    log.info(
      `云备份完成（快照 ${name}，上传 ${toUpload.length} 个文件${missing ? `，盘缺 ${missing}` : ""}${orphans ? `，云端孤儿 ${orphans}` : ""}）`,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("云备份失败：", message);
    state.running = false;
    state.phase = "idle";
    state.lastErrorAt = Date.now();
    state.lastError = message.slice(0, 300);
    writeBackupState(state, root);
    return { ok: false, error: message };
  } finally {
    globalRef.__kamiVaultBackupRunning__ = false;
  }
}

/**
 * 从云端恢复纸匣（脚本用，应用运行时不可调用——会覆盖 vault.sqlite）。
 * 先下 manifest，再拉 catalog 最新快照与全部 files/；dryRun 只清点不动盘。
 */
export async function restoreVaultFromCloud(
  target: CloudTargetClient,
  vaultDir: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ snapshot: string | null; files: number; bytes: number }> {
  const manifestRaw = await target.getFile(MANIFEST);
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest;
  if (!Array.isArray(manifest.files)) throw new Error("manifest 损坏");
  const snapshots = (await target.listDir(CATALOG_DIR)).sort().reverse();
  const snapshot = snapshots[0] ?? null;

  if (!opts.dryRun) {
    mkdirSync(vaultDir, { recursive: true });
    if (snapshot) {
      writeFileSync(join(vaultDir, "vault.sqlite"), await target.getFile(`${CATALOG_DIR}/${snapshot}`));
    }
    for (const f of manifest.files) {
      const abs = join(vaultDir, ...f.path.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, await target.getFile(f.path));
    }
  }
  return { snapshot, files: manifest.files.length, bytes: manifest.files.reduce((n, f) => n + f.size, 0) };
}
