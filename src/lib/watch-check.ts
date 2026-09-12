/**
 * 追踪检测编排（A）。
 *
 * 作用：对追踪列表逐画师拉最新页（pixivUser offset 0 / fanboxCreator 首页），
 *      用水位 diffNewCount 数新作；并发 2、单画师失败不连坐。
 * 为什么复用 fetchSource：吃 /api/source 的 30 分钟服务端缓存（PER-9），
 *      反复打开追踪页不会打爆上游。
 */
import { fetchSource } from "./source.ts";
import { diffNewCount, type WatchArtist } from "./watch.ts";

export type WatchCheckResult = {
  source: WatchArtist["source"];
  id: string;
  newCount: number;
  /** 当前最新作品 id（标已读用）。 */
  newestId?: string;
  /** 最新一张作品缩略图。 */
  latestThumb?: string;
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
  creds: Record<string, unknown>,
): Promise<WatchCheckResult> {
  const base: WatchCheckResult = { source: artist.source, id: artist.id, newCount: 0 };
  try {
    if (artist.source === "pixiv") {
      const r = await fetchImpl({
        data: { op: "pixivUser", id: artist.id, offset: 0, ...creds },
      });
      if (r.op !== "pixivUser") throw new Error("返回异常");
      const items = (r.items ?? []) as { id: string }[];
      return {
        ...base,
        newCount: diffNewCount(items, artist.lastSeenId),
        newestId: r.newestId ?? items[0]?.id,
        latestThumb: pickThumb(r.items?.[0]),
      };
    }
    const r = await fetchImpl({
      data: { op: "fanboxCreator", id: artist.id, ...creds },
    });
    if (r.op !== "fanboxCreator") throw new Error("返回异常");
    const items = (r.items ?? []) as { id: string }[];
    return {
      ...base,
      newCount: diffNewCount(items, artist.lastSeenId),
      newestId: items[0]?.id,
      latestThumb: pickThumb(r.items?.[0]),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "检查失败" };
  }
}

/** 逐画师检查（并发 2）。返回顺序与输入一致。 */
export async function checkWatchArtists(
  artists: WatchArtist[],
  creds: Record<string, unknown>,
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
