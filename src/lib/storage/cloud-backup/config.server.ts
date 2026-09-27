/**
 * 云备份的落盘三件：连接凭据、备份配置、运行状态。
 *
 * 作用：cloud-target.json 存「连接 + 配置」（凭据同 trust 域，先例=同目录 lan-token.json）；
 *      backup-state.json 存引擎运行态（重启不丢，卡上读它）。
 * 用法：只在服务端 import；root 参数留给测试注入临时目录。
 * 为什么：配置跟数据走（.data 卷），不进浏览器设置段——自动备份跑在持有
 *      .data 的那台机器上，跨设备同步这份配置反而语义错位。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "../../log.server.ts";
import { resolveKamiRoot } from "../../proxy.server.ts";
import { DEFAULT_CLOUD_CONFIG, parseCloudConfig, parseCloudTarget, type CloudBackupConfig, type CloudTargetConfig } from "./types.ts";

const log = getLogger("cloud-backup:config");

const TARGET_FILE = "cloud-target.json";
const STATE_FILE = "backup-state.json";

export function backupsDir(root = resolveKamiRoot()): string {
  return join(root, ".data", "backups");
}

export type CloudStored = {
  target: CloudTargetConfig;
  config: CloudBackupConfig;
};

export function readCloudStored(root = resolveKamiRoot()): CloudStored | null {
  const path = join(backupsDir(root), TARGET_FILE);
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      target?: unknown;
      config?: unknown;
    };
    const target = parseCloudTarget(raw.target);
    if (!target) {
      log.warn("云备份连接文件损坏，按未连接处理");
      return null;
    }
    return { target, config: parseCloudConfig(raw.config) ?? DEFAULT_CLOUD_CONFIG };
  } catch (err) {
    log.warn("读取云备份连接失败，按未连接处理：", err instanceof Error ? err.message : err);
    return null;
  }
}

export function writeCloudStored(stored: CloudStored | null, root = resolveKamiRoot()): void {
  const dir = backupsDir(root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, TARGET_FILE);
  if (!stored) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* 删不掉不阻塞（下次覆盖） */
    }
    return;
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored, null, 2), "utf8");
  renameSync(tmp, path);
}

export type CloudBackupPhase = "idle" | "catalog" | "files" | "manifest";

export type CloudBackupState = {
  running: boolean;
  phase: CloudBackupPhase;
  done: number;
  total: number;
  bytesDone: number;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  /** 最近一次成功的 catalog 快照文件名（含时间戳，新的在前）。 */
  snapshots: string[];
  /** 云端有、本地已没有的孤儿文件数（永不自动删，只报告）。 */
  orphans: number;
};

export const EMPTY_BACKUP_STATE: CloudBackupState = {
  running: false,
  phase: "idle",
  done: 0,
  total: 0,
  bytesDone: 0,
  lastOkAt: null,
  lastErrorAt: null,
  lastError: null,
  snapshots: [],
  orphans: 0,
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function parseBackupState(raw: unknown): CloudBackupState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_BACKUP_STATE };
  const o = raw as Record<string, unknown>;
  const phase = o.phase === "catalog" || o.phase === "files" || o.phase === "manifest" ? o.phase : "idle";
  return {
    running: o.running === true,
    phase,
    done: isFiniteNumber(o.done) ? o.done : 0,
    total: isFiniteNumber(o.total) ? o.total : 0,
    bytesDone: isFiniteNumber(o.bytesDone) ? o.bytesDone : 0,
    lastOkAt: isFiniteNumber(o.lastOkAt) ? o.lastOkAt : null,
    lastErrorAt: isFiniteNumber(o.lastErrorAt) ? o.lastErrorAt : null,
    lastError: typeof o.lastError === "string" ? o.lastError.slice(0, 300) : null,
    snapshots: Array.isArray(o.snapshots) ? o.snapshots.filter((s): s is string => typeof s === "string").slice(0, 60) : [],
    orphans: isFiniteNumber(o.orphans) ? o.orphans : 0,
  };
}

export function readBackupState(root = resolveKamiRoot()): CloudBackupState {
  const path = join(backupsDir(root), STATE_FILE);
  try {
    if (!existsSync(path)) return { ...EMPTY_BACKUP_STATE };
    return parseBackupState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...EMPTY_BACKUP_STATE };
  }
}

export function writeBackupState(state: CloudBackupState, root = resolveKamiRoot()): void {
  const dir = backupsDir(root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, STATE_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}
