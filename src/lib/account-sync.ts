/**
 * 应用账号的设置同步（浏览器侧）。
 *
 * 作用：登录应用账号后，把整份「备份」推到 /api/account/sync；换浏览器登录时拉回来。
 * 用法：pullAccountSync(userId) / pushAccountSync(userId)；设置页和同步桥接组件调用。
 * 为什么：备份文件要人手动搬运；这份挂在账号下自动走。本地用 marker 记「已同步到
 *        哪个时间点」，服务端和本地谁新用谁，避免登录瞬间旧数据盖新数据。
 */
import type { BackupFile } from "./backup.ts";

const MARKER_KEY = "kami-account-sync";

export type SyncMarker = { userId: string; syncedAt: number };

export function readSyncMarker(): SyncMarker | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(MARKER_KEY) || "null") as SyncMarker | null;
    if (!raw || typeof raw.userId !== "string" || typeof raw.syncedAt !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeSyncMarker(marker: SyncMarker) {
  try {
    localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch {
    /* 存不进去就算了，下次再比时间 */
  }
}

/** 服务端快照比本地 marker 新（或换了账号 / 没有.marker）才覆盖本地。force 用于手动恢复。 */
export function shouldApplyRemote(remoteExportedAt: number, marker: SyncMarker | null, userId: string, force = false): boolean {
  if (force) return true;
  if (!marker || marker.userId !== userId) return true;
  return remoteExportedAt > marker.syncedAt;
}

type PullResult = { applied: boolean; exportedAt: number | null };

export async function pullAccountSync(userId: string, opts: { force?: boolean } = {}): Promise<PullResult> {
  const res = await fetch("/api/account/sync", { cache: "no-store" });
  if (res.status === 401) return { applied: false, exportedAt: null };
  if (!res.ok) throw new Error("拉取账号数据失败");
  const data = (await res.json()) as { payload: BackupFile | null; exportedAt: number | null };
  if (!data.payload || typeof data.exportedAt !== "number") return { applied: false, exportedAt: null };
  if (!shouldApplyRemote(data.exportedAt, readSyncMarker(), userId, opts.force)) {
    return { applied: false, exportedAt: data.exportedAt };
  }
  // 懒加载：backup-client 连着一串浏览器端模块（IndexedDB / fetch），Node 单测
  // 只测上面的纯比较，静态导入会把整条链拖进来解析失败。
  const { applyBackup } = await import("./backup-client");
  await applyBackup(data.payload);
  writeSyncMarker({ userId, syncedAt: data.exportedAt });
  return { applied: true, exportedAt: data.exportedAt };
}

export async function pushAccountSync(userId: string): Promise<number> {
  const { collectBackup } = await import("./backup-client");
  const backup = await collectBackup();
  const res = await fetch("/api/account/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "未登录应用账号" : "推送账号数据失败");
  writeSyncMarker({ userId, syncedAt: backup.exportedAt });
  return backup.exportedAt;
}
