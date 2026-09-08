/**
 * 上游读接口 HTTP。
 *
 * 浏览列表走 Next 服务端缓存（`.data/source`）。浏览器先画 localStorage，再问这里。
 * key 用账号 id，不含客户端 IP / Host / Cookie 原文。`fresh: true` 跳过缓存重拉源站。
 */
import { fetchSchema } from "@/lib/source";
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
    const message = err instanceof Error ? err.message : "请求失败";
    return Response.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
