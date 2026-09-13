/**
 * 上游读接口 HTTP。
 *
 * 浏览列表走 Next 服务端缓存（`.data/source`）。浏览器先画 localStorage，再问这里。
 * key 用账号 id，不含客户端 IP / Host / Cookie 原文。`fresh: true` 跳过缓存重拉源站。
 */
import { fetchSchema } from "@/lib/source";
import { classifySourceError } from "@/lib/source-errors";
import { cachedDispatchFetch, SOURCE_CACHE_TTL_SECONDS, sourceCacheKey } from "@/lib/storage/source-cache.server";
import { noteCacheWrite } from "@/lib/storage/cache-watermark.server";
import type { FetchInput, FetchOk } from "@/lib/types";

const SOURCE_CACHE_TAG = (key: string) => `source:${key}`;

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const data = fetchSchema.parse(raw) as FetchInput;
    const { dispatchFetch } = await import("@/lib/upstream.server");
    const cacheKey = sourceCacheKey(data);
    const load = () => cachedDispatchFetch(data, dispatchFetch);
    let body: FetchOk;
    if (cacheKey && !data.fresh) {
      try {
        const { unstable_cache } = await import("next/cache");
        body = await unstable_cache(load, ["source", cacheKey], {
          revalidate: SOURCE_CACHE_TTL_SECONDS,
          tags: [SOURCE_CACHE_TAG(cacheKey)],
        })();
      } catch {
        body = await load();
      }
    } else {
      if (cacheKey && data.fresh) {
        try {
          const { revalidateTag } = await import("next/cache");
          // Next 16：revalidateTag 要带 cacheLife profile；{ expire: 0 } = 立即失效
          revalidateTag(SOURCE_CACHE_TAG(cacheKey), { expire: 0 });
        } catch {
          /* 非 Next 环境 */
        }
      }
      body = await load();
    }
    // TD-27：水位计数按响应触发（unstable_cache 命中也计数），不再依赖
    // 磁盘写层——外层命中时 .data 不落盘，写层计数会低估扫描节奏。
    if (cacheKey) noteCacheWrite("source");
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // S7：上游侧失败 502、用户态/参数错误 400，不再一律 400 掩盖源站问题
    const { status, kind, message } = classifySourceError(err);
    console.warn(`[api:source] ${kind}: ${message}`);
    return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
