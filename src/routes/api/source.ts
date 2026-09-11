/**
 * 上游读接口 HTTP。
 *
 * 浏览列表走 Next 服务端缓存（`.data/source`）。浏览器先画 localStorage，再问这里。
 * key 用账号 id，不含客户端 IP / Host / Cookie 原文。`fresh: true` 跳过缓存重拉源站。
 */
import { fetchSchema } from "@/lib/source";
import { classifySourceError } from "@/lib/source-errors";
import { cachedDispatchFetch, sourceCacheKey } from "@/lib/source-cache.server";
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
          revalidate: 1800,
          tags: [SOURCE_CACHE_TAG(cacheKey)],
        })();
      } catch {
        body = await load();
      }
    } else {
      if (cacheKey && data.fresh) {
        try {
          const { revalidateTag } = await import("next/cache");
          revalidateTag(SOURCE_CACHE_TAG(cacheKey));
        } catch {
          /* 非 Next 环境 */
        }
      }
      body = await load();
    }
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // S7：上游侧失败 502、用户态/参数错误 400，不再一律 400 掩盖源站问题
    const { status, kind, message } = classifySourceError(err);
    console.warn(`[api:source] ${kind}: ${message}`);
    return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
