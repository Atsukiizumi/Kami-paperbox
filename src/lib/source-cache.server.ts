/**
 * Next 服务端源站缓存。
 *
 * 作用：日榜、图站、关注、推荐、FANBOX 列表记在 `.data/source`。
 * 用法：sourceCacheKey(input)；cachedDispatchFetch(input, fetchImpl)。input.fresh 跳过读盘、仍写回。
 * 为什么：浏览器先画 localStorage；miss 再问 Next。key 用账号 id，不用 Cookie 原文、不用客户端 IP。
 *        作品详情 fanboxPost / pixivIllust 不进这层。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pixivUserIdFromCookie } from "./browser-login.ts";
import { mediaCacheName } from "./media-cache.server.ts";
import { resolveKamiRoot } from "./proxy.server.ts";
import { noteCacheWrite } from "./cache-watermark.server.ts";
import type { FanboxCursor, FetchInput, FetchOk } from "./types.ts";

export const SOURCE_CACHE_TTL_MS = 30 * 60_000;

type CacheFile = { at: number; body: FetchOk };

function accountScope(input: FetchInput): string {
  return pixivUserIdFromCookie(input.pixivCookie) || pixivUserIdFromCookie(input.fanboxCookie) || "guest";
}

function cursorKey(cursor: FanboxCursor | undefined): string {
  if (!cursor) return "";
  return `${cursor.datetime}:${cursor.id}`;
}

function hashKey(payload: unknown): string {
  return mediaCacheName(JSON.stringify(payload));
}

export function sourceCacheKey(input: FetchInput): string | null {
  const uid = accountScope(input);
  const safe = input.safeMode !== false;
  const hideAi = input.hideAi === true;
  switch (input.op) {
    case "pixivRanking":
      return hashKey({ op: input.op, mode: input.mode, page: input.page, date: input.date ?? "", safe, hideAi, uid });
    case "pixivRecommend":
      return hashKey({ op: input.op, safe, hideAi, uid });
    case "pixivFollowing":
      return hashKey({ op: input.op, page: input.page, safe, hideAi, uid });
    case "fanboxHome":
      return hashKey({ op: input.op, cursor: cursorKey(input.cursor), safe, uid });
    case "fanboxSupporting":
      return hashKey({ op: input.op, cursor: cursorKey(input.cursor), safe, uid });
    case "fanboxCreator":
      return hashKey({ op: input.op, id: input.id, cursor: cursorKey(input.cursor), safe, uid });
    case "fanboxTagged":
      return hashKey({ op: input.op, tag: input.tag, page: input.page, safe, uid });
    case "booruList":
      return hashKey({
        op: input.op,
        site: input.site,
        feed: input.feed,
        tags: input.tags ?? "",
        page: input.page,
        date: input.date ?? "",
        safe,
      });
    case "booruPost":
      return hashKey({ op: input.op, site: input.site, id: input.id, safe });
    case "booruPool":
      return hashKey({ op: input.op, site: input.site, id: input.id, safe });
    case "pixivUgoira":
      return hashKey({ op: input.op, id: input.id });
    default:
      return null;
  }
}

/** @deprecated 用 sourceCacheKey */
export const publicSourceCacheKey = sourceCacheKey;

function cacheDir(root?: string): string {
  return join(root ?? resolveKamiRoot(), ".data", "source");
}

function cacheFile(key: string, root?: string): string {
  return join(cacheDir(root), `${key}.json`);
}

export function readSourceCache(
  key: string,
  root?: string,
  opts?: { now?: number; ttlMs?: number },
): FetchOk | null {
  const path = cacheFile(key, root);
  if (!existsSync(path)) return null;
  try {
    const rec = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    const now = opts?.now ?? Date.now();
    const ttl = opts?.ttlMs ?? SOURCE_CACHE_TTL_MS;
    if (!rec || typeof rec.at !== "number" || !rec.body) return null;
    if (now - rec.at > ttl) {
      try {
        unlinkSync(path);
      } catch {
        /* leftover */
      }
      return null;
    }
    return rec.body;
  } catch {
    return null;
  }
}

export function writeSourceCache(
  key: string,
  body: FetchOk,
  root?: string,
  opts?: { now?: number },
): void {
  try {
    const dir = cacheDir(root);
    mkdirSync(dir, { recursive: true });
    const rec: CacheFile = { at: opts?.now ?? Date.now(), body };
    writeFileSync(cacheFile(key, root), JSON.stringify(rec));
  } catch {
    /* 只读盘 */
  }
  noteCacheWrite("source", root);
}

export async function cachedDispatchFetch(
  input: FetchInput,
  fetchImpl: (input: FetchInput) => Promise<FetchOk>,
  root?: string,
): Promise<FetchOk> {
  const key = sourceCacheKey(input);
  if (!key) return fetchImpl(input);
  if (!input.fresh) {
    const hit = readSourceCache(key, root);
    if (hit) return hit;
  }
  const body = await fetchImpl(input);
  writeSourceCache(key, body, root);
  return body;
}
