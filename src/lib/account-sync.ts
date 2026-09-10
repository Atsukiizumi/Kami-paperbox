/**
 * 应用账号的设置同步（浏览器侧，分段 + 加密版，docs/17）。
 *
 * 作用：登录后按「设置 / 纸匣目录 / 词表 / 历史」四段各自推送 / 拉取，
 *      LWW 粒度到段（TD-09：多设备不再整份互相覆盖）；设置段的凭据以
 *      CipherBox 密文上服务端（SEC-03），密钥 = PBKDF2(账号密码, 服务端 salt)，
 *      只在登录瞬间派生、存 sessionStorage（关标签页即失）。
 * 用法：登录成功后 ensureSyncKek(password)；桥接组件（AccountSyncBridge）
 *      监听四个 store 变化分段推送；pullAccountSync(userId) 拉取合并。
 * 合并规则（关键不变量——凭据永不因同步而丢）：
 *   - 远端 settings 段是密文且本地无 KEK → 跳过该段（本地凭据不动）
 *   - 远端 settings 段 credsOmitted → 应用偏好但凭据字段保留本地
 *   - 无 KEK 且上次拉取看到服务端 settings 是密文 → 本机跳推 settings
 *     （防止 omit 段把服务端密文凭据冲掉）
 */
import type { BackupFile } from "./backup.ts";
import { deriveBoxKey, openJson, randomSaltB64, sealJson, type CipherBox } from "./crypto-box.ts";

export type SyncSegment = "settings" | "vault" | "lexicon" | "history";
export const SYNC_SEGMENTS: readonly SyncSegment[] = ["settings", "vault", "lexicon", "history"];

const MARKER_KEY = "kami-account-sync-v2";
const KEK_KEY = "kami-sync-kek";

// ── 标记（每段各自记录已同步到的时间点） ────────────────────────────────────

export type SyncMarkers = { userId: string; marks: Partial<Record<SyncSegment, number>> };

export function readSyncMarkers(): SyncMarkers | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(MARKER_KEY) || "null") as SyncMarkers | null;
    if (!raw || typeof raw.userId !== "string" || !raw.marks || typeof raw.marks !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeSyncMarkers(markers: SyncMarkers): void {
  try {
    localStorage.setItem(MARKER_KEY, JSON.stringify(markers));
  } catch {
    /* 存不进去就下次重新比较 */
  }
}

/** 段是否该应用远端：marker 旧 / 换账号 / 无 marker / force。 */
export function shouldApplySegment(
  segment: SyncSegment,
  remoteExportedAt: number,
  markers: SyncMarkers | null,
  userId: string,
  force = false,
): boolean {
  if (force) return true;
  if (!markers || markers.userId !== userId) return true;
  return remoteExportedAt > (markers.marks[segment] ?? 0);
}

// ── KEK（账号密码派生，sessionStorage） ─────────────────────────────────────

export async function ensureSyncKek(password: string): Promise<boolean> {
  const res = await fetch("/api/account/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "kdf-salt" }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { kdfSalt?: string };
  if (!data.kdfSalt) return false;
  // 可导出：KEK 要以原始字节形态进 sessionStorage（重新 importKey 使用）
  const key = await deriveBoxKey(password, data.kdfSalt, undefined, true);
  const raw = await crypto.subtle.exportKey("raw", key);
  let bin = "";
  for (const b of new Uint8Array(raw)) bin += String.fromCharCode(b);
  try {
    sessionStorage.setItem(KEK_KEY, btoa(bin));
  } catch {
    return false;
  }
  return true;
}

export function hasSyncKek(): boolean {
  try {
    return Boolean(sessionStorage.getItem(KEK_KEY));
  } catch {
    return false;
  }
}

/** 登出时清掉（client.ts 的 signOut 回调里调）。 */
export function clearSyncKek(): void {
  try {
    sessionStorage.removeItem(KEK_KEY);
  } catch {
    /* ignore */
  }
}

async function loadKek(): Promise<CryptoKey | null> {
  try {
    const b64 = sessionStorage.getItem(KEK_KEY);
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

// ── 段载荷构造（纯函数部分可单测） ──────────────────────────────────────────

export type SettingsSegData = { settings: unknown; proxyUrl?: unknown };

export type SegmentPayload =
  | { kind: "cipher"; box: CipherBox }
  | { kind: "plain"; data: unknown; credsOmitted?: boolean };

/** credsOmitted 推送：凭据字段真的不上服务端（置空），拉取侧按标记保留本地。 */
export function omitSettingsCredentials(data: SettingsSegData): SettingsSegData {
  const settings = { ...(data.settings as Record<string, unknown>) };
  for (const field of [
    "pixivCookie",
    "fanboxCookie",
    "danbooruLogin",
    "danbooruApiKey",
    "saucenaoApiKey",
    "accounts",
    "activeAccountId",
  ]) {
    settings[field] = Array.isArray(settings[field]) ? [] : "";
  }
  return { settings, proxyUrl: data.proxyUrl };
}

export async function buildSegmentPayload(
  segment: SyncSegment,
  backup: BackupFile,
  opts: { kek: CryptoKey | null },
): Promise<SegmentPayload> {
  if (segment === "settings") {
    const data: SettingsSegData = { settings: backup.settings, proxyUrl: backup.proxyUrl };
    if (opts.kek) {
      return { kind: "cipher", box: await sealJson(opts.kek, data, randomSaltB64()) };
    }
    return { kind: "plain", credsOmitted: true, data: omitSettingsCredentials(data) };
  }
  if (segment === "vault") return { kind: "plain", data: backup.vault };
  if (segment === "lexicon") return { kind: "plain", data: { lexicon: backup.lexicon, catalog: backup.catalog } };
  return { kind: "plain", data: backup.history };
}

// ── 推 / 拉 ────────────────────────────────────────────────────────────────

/** 上次拉取看到的服务端分段形态（settings 是否密文），推送守卫用。 */
let serverSettingsEncrypted = false;

export async function pushAccountSyncSegment(userId: string, segment: SyncSegment): Promise<number | null> {
  const kek = await loadKek();
  if (segment === "settings" && !kek && serverSettingsEncrypted) {
    // 守卫：服务端存着密文凭据，而本机没有钥匙——推 omit 段会把凭据冲掉。
    // 等下次登录（KEK 在手）再推设置段；其余段不受影响。
    return null;
  }
  const { collectBackup } = await import("./backup-client");
  const backup = await collectBackup();
  const payload = await buildSegmentPayload(segment, backup, { kek });
  const exportedAt = Date.now();
  const res = await fetch("/api/account/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ segment, exportedAt, payload }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "未登录应用账号" : `推送 ${segment} 段失败`);
  const markers = readSyncMarkers();
  writeSyncMarkers({
    userId,
    marks: { ...(markers?.userId === userId ? markers.marks : {}), [segment]: exportedAt },
  });
  return exportedAt;
}

type PullResult = { applied: SyncSegment[]; skipped: string[] };

export async function pullAccountSync(userId: string, opts: { force?: boolean } = {}): Promise<PullResult> {
  const res = await fetch("/api/account/sync", { cache: "no-store" });
  if (res.status === 401) return { applied: [], skipped: [] };
  if (!res.ok) throw new Error("拉取账号数据失败");
  const data = (await res.json()) as {
    segments: Partial<Record<SyncSegment, { payload: SegmentPayload; exportedAt: number }>>;
    legacy: { payload: unknown; exportedAt: number } | null;
    kdfSalt: string | null;
  };

  const markers = readSyncMarkers();
  const kek = await loadKek();
  const applied: SyncSegment[] = [];
  const skipped: string[] = [];
  const { applySegment, collectBackup } = await import("./backup-client");

  for (const segment of SYNC_SEGMENTS) {
    const remote = data.segments[segment];
    if (!remote) continue;
    if (segment === "settings") {
      serverSettingsEncrypted = remote.payload.kind === "cipher";
    }
    if (!shouldApplySegment(segment, remote.exportedAt, markers, userId, opts.force)) continue;
    try {
      if (segment === "settings" && remote.payload.kind === "cipher") {
        if (!kek) {
          skipped.push("settings");
          continue;
        }
        const opened = await openJson<SettingsSegData>(kek, remote.payload.box);
        await applySegment("settings", opened);
      } else if (segment === "settings" && remote.payload.kind === "plain") {
        // 应用偏好，凭据字段保留本地
        const local = (await collectBackup()).settings as Record<string, unknown>;
        const incoming = (remote.payload.data as SettingsSegData).settings as Record<string, unknown>;
        for (const field of [
          "pixivCookie",
          "fanboxCookie",
          "danbooruLogin",
          "danbooruApiKey",
          "saucenaoApiKey",
          "accounts",
          "activeAccountId",
        ]) {
          incoming[field] = local[field] ?? (Array.isArray(incoming[field]) ? [] : "");
        }
        await applySegment("settings", remote.payload.data as SettingsSegData);
      } else if (remote.payload.kind === "plain") {
        await applySegment(segment, remote.payload.data);
      }
      applied.push(segment);
    } catch {
      skipped.push(segment);
    }
  }

  // 过渡期：只有旧单行数据（分段表为空）时整份应用一次，之后按段走
  if (applied.length === 0 && skipped.length === 0 && data.legacy && data.legacy.payload) {
    if (shouldApplySegment("settings", data.legacy.exportedAt, markers, userId, opts.force)) {
      const { applyBackup } = await import("./backup-client");
      await applyBackup(data.legacy.payload);
      applied.push("settings", "vault", "lexicon", "history");
    }
  }

  if (applied.length) {
    const marks = { ...(markers?.userId === userId ? markers.marks : {}) } as Partial<Record<SyncSegment, number>>;
    for (const segment of applied) {
      marks[segment] = data.segments[segment]?.exportedAt ?? (data.legacy?.exportedAt ?? Date.now());
    }
    writeSyncMarkers({ userId, marks });
  }
  return { applied, skipped };
}
