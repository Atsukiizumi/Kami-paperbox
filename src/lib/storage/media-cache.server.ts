/**
 * Next 服务端封面缓存。
 *
 * 作用：把 `/api/media` 拉过的 pximg / 图站图落到服务端 `.data/media`，一周内不再打源站。
 * 用法：readCachedMedia(url)；miss 后再 writeCachedMedia。测试传入 tmp root。
 * 为什么：浏览器缓存按源分开，换 127.0.0.1 / 局域网 IP 会 miss。服务端按源站 URL 记，
 *        不含客户端 IP、Host、Cookie。FANBOX / 搜图引擎不进盘。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKamiRoot } from "../proxy.server.ts";
import { noteCacheWrite } from "./cache-watermark.server.ts";

export const MEDIA_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
export const MEDIA_CACHE_MAX_BYTES = 8 * 1024 * 1024;

type CacheMeta = {
  type: string;
  at: number;
};

export function mediaCacheName(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export function sniffMediaType(bytes: Uint8Array, fallback = "application/octet-stream"): string {
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return fallback;
}

export function isDiskCacheableMedia(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host.endsWith("fanbox.cc")) return false;
  if (host.endsWith("ascii2d.net") || host.endsWith("saucenao.com") || host.endsWith("iqdb.org")) {
    return false;
  }
  return true;
}

function cacheDir(root?: string): string {
  return join(root ?? resolveKamiRoot(), ".data", "media");
}

function cachePaths(url: string, root?: string) {
  const dir = cacheDir(root);
  const name = mediaCacheName(url);
  return {
    dir,
    bin: join(dir, `${name}.bin`),
    meta: join(dir, `${name}.json`),
  };
}

export function readCachedMedia(
  url: string,
  root?: string,
  opts?: { now?: number; ttlMs?: number },
): { bytes: Uint8Array; type: string } | null {
  const { bin, meta } = cachePaths(url, root);
  if (!existsSync(bin) || !existsSync(meta)) return null;
  try {
    const rec = JSON.parse(readFileSync(meta, "utf8")) as CacheMeta;
    const now = opts?.now ?? Date.now();
    const ttl = opts?.ttlMs ?? MEDIA_CACHE_TTL_MS;
    if (!rec || typeof rec.type !== "string" || typeof rec.at !== "number") return null;
    if (now - rec.at > ttl) {
      try {
        unlinkSync(bin);
        unlinkSync(meta);
      } catch {
        /* leftover */
      }
      return null;
    }
    return { bytes: new Uint8Array(readFileSync(bin)), type: rec.type || "application/octet-stream" };
  } catch (err) {
    console.warn("[media-cache:read] 缓存读失败（按未命中处理）：", err instanceof Error ? err.message : err);
    return null;
  }
}

export function writeCachedMedia(
  url: string,
  bytes: Uint8Array,
  type: string,
  root?: string,
  opts?: { now?: number },
): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MEDIA_CACHE_MAX_BYTES) return;
  const { dir, bin, meta } = cachePaths(url, root);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(bin, bytes);
    writeFileSync(meta, JSON.stringify({ type: type || "application/octet-stream", at: opts?.now ?? Date.now() }));
  } catch {
    /* Vercel / 只读盘：忽略 */
  }
  noteCacheWrite("media", root);
}
