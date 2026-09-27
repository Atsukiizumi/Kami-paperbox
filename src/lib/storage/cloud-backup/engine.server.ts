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
 *      全量哈希每轮扫数十 GB 不可接受。manifest 每传 20 个文件增量写回云端，
 *      中断重跑时已传过的文件不再重传（断点续传的实话版）。
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
const MANIFEST_EVERY = 20;
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
  __kamiVaultBackupUnsupported__?: string;
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

export function isVaultBackupSchedulerActive(): boolean {
  return Boolean(globalRef.__kamiVaultBackupTimer__);
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

/** 惰性启动：幂等；未连接也照起（tick 里判），VERCEL/不可写则停用（同因只记一次日志）。 */
export function ensureVaultBackupScheduler(root?: string): void {
  if (globalRef.__kamiVaultBackupTimer__) return;
  const reason = unsupportedNow(root ?? resolveKamiRoot());
  if (reason) {
    if (globalRef.__kamiVaultBackupUnsupported__ !== reason) {
      globalRef.__kamiVaultBackupUnsupported__ = reason;
      log.warn(reason);
    }
    return;
  }
  globalRef.__kamiVaultBackupUnsupported__ = undefined;
  globalRef.__kamiVaultBackupTimer__ = setInterval(() => void maybeRunDueBackup(), TICK_MS);
  globalRef.__kamiVaultBackupTimer__.unref?.();
  void maybeRunDueBackup();
}

/**
 * 到期才跑一轮（tick 的身体，独立导出以便测试）。开机补偿也走这里：
 * state.lastOkAt 老于间隔就先补跑一次。deps 透传给 runVaultBackup。
 */
export async function maybeRunDueBackup(deps: BackupDeps = {}): Promise<{ ran: boolean; reason: string }> {
  try {
    const stored = readCloudStored(deps.root);
    if (!stored) return { ran: false, reason: "未连接" };
    if (!stored.config.enabled) return { ran: false, reason: "未开启" };
    if (isVaultBackupRunning()) return { ran: false, reason: "进行中" };
    const state = reconcileBackupState(deps.root);
    const dueAt = (state.lastOkAt ?? 0) + stored.config.intervalHours * 3_600_000;
    if (Date.now() < dueAt) return { ran: false, reason: "未到期" };
    const res = await runVaultBackup("auto", deps);
    return { ran: res.ok, reason: res.ok ? "已跑" : res.error ?? "失败" };
  } catch (err) {
    log.warn("定时备份 tick 失败：", err instanceof Error ? err.message : err);
    return { ran: false, reason: "tick 异常" };
  }
}

/**
 * 进程崩溃/重启会在 state 文件里留下 running:true 的尸体——凡读 state 先对账：
 * 内存里没有在跑就把 running 摘掉落盘，否则设置卡会永远显示假进度。
 */
export function reconcileBackupState(root?: string): CloudBackupState {
  const state = readBackupState(root);
  if (state.running && !isVaultBackupRunning()) {
    state.running = false;
    state.phase = "idle";
    writeBackupState(state, root);
  }
  return state;
}

/** VACUUM INTO 出一致性副本：单条 SQL 读事务，不依赖 node:sqlite backup API 面貌。 */
export function vacuumVaultSnapshot(vaultDir: string, dest: string): void {
  const db = new DatabaseSync(join(vaultDir, "vault.sqlite"));
  try {
    // 引擎与纸匣写路径并发：等锁 5s，抢不到留给下一轮
    db.exec("PRAGMA busy_timeout = 5000");
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

/**
 * 像素上传：文件在 worker 里惰性读（首轮可能数 GB，绝不整体进内存）；
 * 盘上已缺（扫描后被删）按 miss 跳过不失败；每传完一个回调一次（manifest 增量写回用）。
 */
async function uploadAll(
  target: CloudTargetClient,
  items: { path: string; size: number; mtime: number }[],
  state: CloudBackupState,
  storeDir: string,
  root: string | undefined,
  onUploaded?: (entry: { path: string; size: number; mtime: number }) => Promise<void> | void,
): Promise<number> {
  let cursor = 0;
  let missed = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(storeDir, ...item.path.split("/")));
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          missed += 1;
          continue;
        }
        throw err;
      }
      await withRetry(() => target.putFile(item.path, new Uint8Array(bytes)), `上传 ${item.path}`);
      state.done += 1;
      state.bytesDone += bytes.byteLength;
      if (state.done % 10 === 0 || state.done === state.total) writeBackupState(state, root);
      await onUploaded?.(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
  return missed;
}

/** manifest 路径段校验：云上的清单是外部输入，`..`/盘符/绝对路径一律拒绝（防恢复写穿 vault 目录）。 */
function manifestEntryOk(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 400) return false;
  for (const seg of path.split("/")) {
    if (seg.length === 0 || seg === "." || seg === ".." || /^[A-Za-z]:$/.test(seg) || seg.includes("\\")) return false;
  }
  return true;
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
  const state: CloudBackupState = { ...reconcileBackupState(root), running: true, done: 0, total: 0, bytesDone: 0, phase: "catalog" };
  globalRef.__kamiVaultBackupRunning__ = true;
  writeBackupState(state, root);

  try {
    // ① 目录快照：tmp 落盘 → 上传 → 滚动删旧（只认自己的 vault-meta-*.sqlite，不碰用户放的同目录杂物）
    const tmpDir = join(backupsDir(root), "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const name = `vault-meta-${stamp()}.sqlite`;
    const tmpPath = join(tmpDir, name);
    vacuumVaultSnapshot(store.dir, tmpPath);
    const bytes = readFileSync(tmpPath);
    rmSync(tmpPath, { force: true });
    await withRetry(() => target.putFile(`${CATALOG_DIR}/${name}`, new Uint8Array(bytes)), `上传 ${name}`);
    const oldOnes = (await target.listDir(CATALOG_DIR))
      .filter((n) => n !== name && /^vault-meta-\d{8}-\d{9}\.sqlite$/.test(n))
      .sort()
      .reverse();
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

    // ② 像素增量：catalog（pages 行）驱动，含纸篓条目；与云端 manifest diff，只传新增/变更
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
      remote.files = remote.files.filter((f) => f && manifestEntryOk(f.path));
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

    // 增量写回：每 MANIFEST_EVERY 个把已传条目并进云端 manifest——
    // 中断重跑时 size+mtime 已命中的不再重传（断点续传）。写失败只降级为重传，不炸整轮。
    const merged = new Map(remote.files.map((f) => [f.path, f]));
    let sinceFlush = 0;
    const flushManifest = async () => {
      const next: Manifest = { schemaVersion: 1, files: [...merged.values()], updatedAt: Date.now() };
      try {
        await target.putFile(MANIFEST, new TextEncoder().encode(JSON.stringify(next)));
      } catch {
        /* 下批再写；最差情况是中断后多传一遍 */
      }
      sinceFlush = 0;
    };
    const missed = await uploadAll(target, toUpload, state, store.dir, root, async (entry) => {
      merged.set(entry.path, entry);
      sinceFlush += 1;
      if (sinceFlush >= MANIFEST_EVERY) await flushManifest();
    });
    missing += missed;

    // ③ 孤儿：云端（上一轮 manifest）有、本地登记已没有。只计数，永不自动删。
    const localPaths = new Set(local.map((f) => f.path));
    const orphans = remote.files.filter((f) => !localPaths.has(f.path)).length;

    // ④ 收尾 manifest（以本轮本地全量为准）+ 状态落盘
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
 * manifest 是外部输入：路径段不过关直接整个拒绝（防写穿 vault 目录）。
 */
export async function restoreVaultFromCloud(
  target: CloudTargetClient,
  vaultDir: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ snapshot: string | null; files: number; bytes: number }> {
  const manifestRaw = await target.getFile(MANIFEST);
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest;
  if (!Array.isArray(manifest.files)) throw new Error("manifest 损坏");
  for (const f of manifest.files) {
    if (!f || !manifestEntryOk(f.path)) throw new Error(`manifest 含非法路径，拒绝恢复：${String(f?.path).slice(0, 80)}`);
  }
  const snapshots = (await target.listDir(CATALOG_DIR)).filter((n) => /^vault-meta-\d{8}-\d{9}\.sqlite$/.test(n)).sort().reverse();
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
