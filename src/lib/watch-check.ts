/**
 * 追踪检测编排（A）。
 *
 * 作用：对追踪列表逐画师拉最新页（pixivUser offset 0 / fanboxCreator 首页），
 *      用水位 diffNewCount 数新作；并发 2、单画师失败不连坐。
 * 为什么复用 fetchSource：吃 /api/source 的 30 分钟服务端缓存（PER-9），
 *      反复打开追踪页不会打爆上游。
 */
import { fetchSource } from "./source.ts";
import { DEFAULT_PIXIV_SEARCH } from "./pixiv-search.ts";
import { diffNewCount, type WatchArtist, type WatchTag } from "./watch.ts";
import type { WorkCard } from "./types.ts";

/** 聚合流每组展示上限：检查只拉一页（pixiv 60 / booru 20 / fanbox 首页），截前 20 铺一屏。 */
export const WATCH_FEED_ITEM_CAP = 20;

/** 最新页作品透传（聚合视图用）：完整 WorkCard，直接喂 ArtworkGrid。 */
export type FeedItem = WorkCard;

function feedItems(raw: unknown, fallbackSource: WorkCard["source"]): FeedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedItem[] = [];
  for (const row of raw) {
    const rec = row as Record<string, unknown>;
    if (!rec || typeof rec.id !== "string") continue;
    out.push({
      source: (typeof rec.source === "string" ? rec.source : fallbackSource) as WorkCard["source"],
      id: rec.id,
      title: typeof rec.title === "string" ? rec.title : "",
      author: typeof rec.author === "string" ? rec.author : "",
      authorId: typeof rec.authorId === "string" ? rec.authorId : "",
      thumb: pickThumb(rec),
      pageCount: Number(rec.pageCount) || 1,
      tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
      aiType: Number(rec.aiType) || undefined,
      xRestrict: Number(rec.xRestrict) || undefined,
      rating: typeof rec.rating === "string" ? rec.rating : undefined,
      illustType: Number(rec.illustType) || undefined,
    });
    if (out.length >= WATCH_FEED_ITEM_CAP) break;
  }
  return out;
}

function latestDateOf(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? (raw[0] as { date?: string } | undefined) : undefined;
  return typeof first?.date === "string" ? first.date : undefined;
}

export type WatchCheckResult = {
  source: WatchArtist["source"];
  id: string;
  newCount: number;
  /** 当前最新作品 id（标已读用）。 */
  newestId?: string;
  /** 最新一张作品缩略图。 */
  latestThumb?: string;
  /** 最新页作品（聚合流视图消费，截 20）。 */
  items?: FeedItem[];
  /** 最新一条的发布时间。 */
  latestDate?: string;
  error?: string;
};

type Fetch = typeof fetchSource;

function pickThumb(item: unknown): string {
  const rec = item as { thumb?: string; regular?: string } | null;
  return rec?.thumb || rec?.regular || "";
}

async function checkOne(
  artist: WatchArtist,
  fetchImpl: Fetch,
  creds: (source: WatchArtist["source"]) => Record<string, unknown>,
): Promise<WatchCheckResult> {
  const base: WatchCheckResult = { source: artist.source, id: artist.id, newCount: 0 };
  try {
    if (artist.source === "pixiv") {
      const r = await fetchImpl({
        data: { op: "pixivUser", id: artist.id, offset: 0, ...creds("pixiv") },
      });
      if (r.op !== "pixivUser") throw new Error("返回异常");
      const items = (r.items ?? []) as { id: string }[];
      return {
        ...base,
        newCount: diffNewCount(items, artist.lastSeenId),
        newestId: r.newestId ?? items[0]?.id,
        latestThumb: pickThumb(r.items?.[0]),
        items: feedItems(r.items, "pixiv"),
        latestDate: latestDateOf(r.items),
      };
    }
    const r = await fetchImpl({
      data: { op: "fanboxCreator", id: artist.id, ...creds("fanbox") },
    });
    if (r.op !== "fanboxCreator") throw new Error("返回异常");
    const items = (r.items ?? []) as { id: string }[];
    return {
      ...base,
      newCount: diffNewCount(items, artist.lastSeenId),
      newestId: items[0]?.id,
      latestThumb: pickThumb(r.items?.[0]),
      items: feedItems(r.items, "fanbox"),
      latestDate: latestDateOf(r.items),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "检查失败" };
  }
}

/** 逐画师检查（并发 2）。creds 按画师站点现取（每站点 R-18 各管各的）。返回顺序与输入一致。 */
export async function checkWatchArtists(
  artists: WatchArtist[],
  creds: (source: WatchArtist["source"]) => Record<string, unknown>,
  opts: { fetchImpl?: Fetch; concurrency?: number } = {},
): Promise<WatchCheckResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetchSource;
  const concurrency = opts.concurrency ?? 2;
  const results: WatchCheckResult[] = new Array(artists.length);
  let cursor = 0;
  async function worker() {
    while (cursor < artists.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await checkOne(artists[index]!, fetchImpl, creds);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, artists.length) }, worker));
  return results;
}

/** 全部新作数之和（红点角标）。 */
export function totalNew(results: WatchCheckResult[]): number {
  return results.reduce((sum, r) => sum + (r.error ? 0 : r.newCount), 0);
}

// ── 标签订阅检查（09-21-tag-watch-vault-filter）──────────────────────────────

export type TagWatchCheckResult = {
  source: WatchTag["source"];
  tag: string;
  newCount: number;
  newestId?: string;
  latestThumb?: string;
  /** 最新页作品（聚合流视图消费，截 20）。 */
  items?: FeedItem[];
  /** 最新一条的发布时间。 */
  latestDate?: string;
  error?: string;
};

async function checkOneTag(
  watch: WatchTag,
  fetchImpl: Fetch,
  creds: (source: WatchTag["source"]) => Record<string, unknown>,
): Promise<TagWatchCheckResult> {
  const base: TagWatchCheckResult = { source: watch.source, tag: watch.tag, newCount: 0 };
  try {
    // pixiv 用搜索最新序（date_d 新→旧）；booru 用 recent + 标签过滤（同为新→旧）。
    // 水位判定与画师同款 diffNewCount：无水位→0 不虚报、水位不在首页→0 保守。
    const r =
      watch.source === "pixiv"
        ? await fetchImpl({
            data: {
              op: "pixivSearch",
              word: watch.tag,
              page: 1,
              filter: { ...DEFAULT_PIXIV_SEARCH, order: "date_d" },
              ...creds("pixiv"),
            },
          })
        : await fetchImpl({
            data: { op: "booruList", site: watch.source, feed: "recent", tags: watch.tag, page: 1, ...creds(watch.source) },
          });
    if (r.op !== "pixivSearch" && r.op !== "booruList") throw new Error("返回异常");
    const items = (r.items ?? []) as { id: string; thumb?: string }[];
    return {
      ...base,
      newCount: diffNewCount(items, watch.lastSeenId),
      newestId: items[0]?.id,
      latestThumb: pickThumb(items[0]),
      items: feedItems(r.items, watch.source),
      latestDate: latestDateOf(r.items),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "检查失败" };
  }
}

/** 逐标签检查（并发 2，单条失败不连坐）。creds 按站点现取——R-18 开关各站各管各的。 */
export async function checkWatchTags(
  tags: WatchTag[],
  creds: (source: WatchTag["source"]) => Record<string, unknown>,
  opts: { fetchImpl?: Fetch; concurrency?: number } = {},
): Promise<TagWatchCheckResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetchSource;
  const concurrency = opts.concurrency ?? 2;
  const results: TagWatchCheckResult[] = new Array(tags.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tags.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await checkOneTag(tags[index]!, fetchImpl, creds);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tags.length) }, worker));
  return results;
}
