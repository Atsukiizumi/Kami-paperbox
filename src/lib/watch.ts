/**
 * 画师更新追踪（A）：数据模型 + 解析 + 水位 diff 纯函数。
 *
 * 作用：追踪列表与水位线随设置段同步（zustand persist + 备份往返）；
 *      检测时用 diffNewCount 数出水位之上的新作数。
 * 为什么无水位返回 0：刚追踪的画师不该虚报一屏红点，从「下一次检查」开始算新。
 */

export const WATCH_SOURCES = ["pixiv", "fanbox"] as const;
export type WatchSource = (typeof WATCH_SOURCES)[number];

export type WatchArtist = {
  source: WatchSource;
  id: string;
  name: string;
  avatar: string;
  addedAt: number;
  /** 水位：已读到的最新作品 id。 */
  lastSeenId?: string;
  lastCheckedAt?: number;
};

export const WATCH_DEFAULT_LIMIT = 100;
export const WATCH_MIN_LIMIT = 20;
export const WATCH_MAX_LIMIT = 500;

export function clampWatchLimit(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : WATCH_DEFAULT_LIMIT;
  return Math.min(WATCH_MAX_LIMIT, Math.max(WATCH_MIN_LIMIT, v));
}

function isWatchSource(v: unknown): v is WatchSource {
  return typeof v === "string" && (WATCH_SOURCES as readonly string[]).includes(v);
}

/** 解析外部（备份/同步段）来的追踪列表：逐项校验，坏项丢弃，超限截取。 */
export function parseWatchArtists(raw: unknown, limit = WATCH_DEFAULT_LIMIT): WatchArtist[] {
  if (!Array.isArray(raw)) return [];
  const cap = clampWatchLimit(limit);
  const out: WatchArtist[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (!isWatchSource(rec.source)) continue;
    const id = typeof rec.id === "string" ? rec.id.slice(0, 80) : "";
    if (!id) continue;
    const parsed: WatchArtist = {
      source: rec.source,
      id,
      name: typeof rec.name === "string" ? rec.name.slice(0, 80) : "",
      avatar: typeof rec.avatar === "string" && rec.avatar.startsWith("http") ? rec.avatar.slice(0, 300) : "",
      addedAt: Number(rec.addedAt) || 0,
    };
    if (typeof rec.lastSeenId === "string") parsed.lastSeenId = rec.lastSeenId.slice(0, 80);
    if (rec.lastCheckedAt) parsed.lastCheckedAt = Number(rec.lastCheckedAt);
    out.push(parsed);
    if (out.length >= cap) break;
  }
  return out;
}

/** 水位之上的新作数：按返回顺序（新→旧）数到水位为止。
 *  无水位 → 0（刚追踪不虚报）；水位不在本页 → 0（更深分页无法判定，保守不报）。 */
export function diffNewCount(items: { id: string }[], lastSeenId: string | undefined): number {
  if (!lastSeenId) return 0;
  let n = 0;
  for (const item of items) {
    if (item.id === lastSeenId) return n;
    n += 1;
  }
  return 0;
}

// ── 标签订阅（09-21-tag-watch-vault-filter）──────────────────────────────────
// 画师追踪的姊妹模型：题材维度的新作水位。FANBOX 不进（tagged 流要登录、
// 题材弱）；上限固定 30（booru recent 单次检查 ≤4 个上游请求，并发 2 + 30min
// 服务端缓存可控），不做可调上限——真实需求出现再开。

export const TAG_WATCH_SOURCES = ["pixiv", "yande", "konachan", "danbooru"] as const;
export type TagWatchSource = (typeof TAG_WATCH_SOURCES)[number];
export const TAG_WATCH_LIMIT = 30;

export type WatchTag = {
  source: TagWatchSource;
  /** 订阅词（trim 后 1..80）。booru 空格写作下划线，由调用方保证。 */
  tag: string;
  addedAt: number;
  /** 水位：最近已读的作品 id（新→旧序的第一条）。 */
  lastSeenId?: string;
  lastCheckedAt?: number;
};

export function isTagWatchSource(v: unknown): v is TagWatchSource {
  return typeof v === "string" && (TAG_WATCH_SOURCES as readonly string[]).includes(v);
}

/** 同站同词（大小写不敏感）视为同一订阅：去重键。 */
export function tagWatchKey(source: TagWatchSource, tag: string): string {
  return `${source}:${tag.trim().toLowerCase()}`;
}

/** 解析外部（备份/同步段）来的订阅列表：逐项校验，坏项丢弃，超限截取。 */
export function parseWatchTags(raw: unknown): WatchTag[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchTag[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (!isTagWatchSource(rec.source)) continue;
    const tag = typeof rec.tag === "string" ? rec.tag.trim().slice(0, 80) : "";
    if (!tag) continue;
    const key = tagWatchKey(rec.source, tag);
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed: WatchTag = {
      source: rec.source,
      tag,
      addedAt: Number(rec.addedAt) || 0,
    };
    if (typeof rec.lastSeenId === "string") parsed.lastSeenId = rec.lastSeenId.slice(0, 80);
    if (rec.lastCheckedAt) parsed.lastCheckedAt = Number(rec.lastCheckedAt);
    out.push(parsed);
    if (out.length >= TAG_WATCH_LIMIT) break;
  }
  return out;
}
