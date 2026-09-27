/**
 * 云备份共享类型与解析（客户端形状）。
 *
 * 作用：WebDAV / S3 兼容两协议的连接配置、备份配置的校验与掩码；
 *      适配器与引擎都在 *.server.ts，这里零 Node 依赖，设置卡可直接 import。
 * 为什么：凭据永不过浏览器——设置卡只提交表单、只拿到掩码，parse 收敛在这一份。
 */

export type CloudKind = "webdav" | "s3";

export type WebDavTarget = {
  kind: "webdav";
  /** 站点根，如 https://dav.jianguoyun.com/dav/ */
  url: string;
  username: string;
  password: string;
  /** 云盘上的备份根目录，如 kami-paperbox-backup */
  remoteDir: string;
};

export type S3Target = {
  kind: "s3";
  /** 兼容端点（路径风格），如 https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  remoteDir: string;
};

export type CloudTargetConfig = WebDavTarget | S3Target;

export type CloudBackupConfig = {
  /** 定时备份开关：默认 false——连接 ≠ 开启，用户显式打开才跑（拍板 2026-09-21）。 */
  enabled: boolean;
  intervalHours: number;
  keep: number;
};

export const DEFAULT_CLOUD_CONFIG: CloudBackupConfig = { enabled: false, intervalHours: 24, keep: 14 };
export const DEFAULT_REMOTE_DIR = "kami-paperbox-backup";

export const INTERVAL_RANGE = { min: 1, max: 168 } as const;
export const KEEP_RANGE = { min: 1, max: 60 } as const;

export type CloudTargetMasked = { kind: CloudKind; host: string; remoteDir: string };

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

/** 明文 http 只对回环地址豁免（本机 MinIO/Alist 调试），其余一律要求 https。 */
export function isInsecureUrlBlocked(url: URL): boolean {
  return url.protocol === "http:" && !isLoopbackHost(url.hostname);
}

/** 控制字符检查（no-control-regex 规则禁字面正则）：凭据/URL 不收，防头注入。 */
function hasControlChar(v: string): boolean {
  return [...v].some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function secretString(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > max) return null;
  if (hasControlChar(v)) return null;
  return v;
}

/** 备份根目录：只收干净的一段段路径（1~8 段，每段 ≤80 字符），坏输入回默认。 */
export function parseRemoteDir(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_REMOTE_DIR;
  const segs = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segs.length === 0 || segs.length > 8) return DEFAULT_REMOTE_DIR;
  for (const seg of segs) {
    if (seg === "." || seg === ".." || seg.length > 80 || hasControlChar(seg)) {
      return DEFAULT_REMOTE_DIR;
    }
  }
  return segs.join("/");
}

export function parseCloudTarget(raw: unknown): CloudTargetConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  const remoteDir = parseRemoteDir(o.remoteDir);
  if (kind === "webdav") {
    let url: URL;
    try {
      url = new URL(secretString(o.url, 300) ?? "");
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && isInsecureUrlBlocked(url)) return null;
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    const username = secretString(o.username, 200);
    const password = secretString(o.password, 200);
    if (!username || !password) return null;
    return { kind: "webdav", url: url.toString(), username, password, remoteDir };
  }
  if (kind === "s3") {
    let endpoint: URL;
    try {
      endpoint = new URL(secretString(o.endpoint, 300) ?? "");
    } catch {
      return null;
    }
    if (endpoint.protocol !== "https:" && isInsecureUrlBlocked(endpoint)) return null;
    const bucket = secretString(o.bucket, 120);
    const accessKeyId = secretString(o.accessKeyId, 200);
    const secretAccessKey = secretString(o.secretAccessKey, 200);
    if (!bucket || !accessKeyId || !secretAccessKey) return null;
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(bucket)) return null;
    const region = secretString(o.region, 60) ?? "auto";
    return { kind: "s3", endpoint: endpoint.toString(), region, bucket, accessKeyId, secretAccessKey, remoteDir };
  }
  return null;
}

export function parseCloudConfig(raw: unknown): CloudBackupConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return null;
  const interval = Number(o.intervalHours);
  const keep = Number(o.keep);
  if (!Number.isInteger(interval) || interval < INTERVAL_RANGE.min || interval > INTERVAL_RANGE.max) return null;
  if (!Number.isInteger(keep) || keep < KEEP_RANGE.min || keep > KEEP_RANGE.max) return null;
  return { enabled: o.enabled, intervalHours: interval, keep };
}

export function maskCloudTarget(t: CloudTargetConfig): CloudTargetMasked {
  const url = t.kind === "webdav" ? new URL(t.url) : new URL(t.endpoint);
  return { kind: t.kind, host: url.host, remoteDir: t.remoteDir };
}

export function cloudKindLabel(kind: CloudKind): string {
  return kind === "webdav" ? "WebDAV" : "S3 兼容";
}
