/**
 * 图片代理。
 *
 * 作用：浏览器只请求本站 `/api/media?u=`，由 Next 服务端带 Referer 去拉 pximg / 图站。
 * 为什么：直接把 i.pximg.net 丢给 <img> 会 403。公开封面按源站 URL 缓存在服务端，
 *        跟客户端 IP / Host 无关。FANBOX 才读登录 Cookie。abort 当正常结束。
 */
import { isAbortError } from "@/lib/abort";
import { isDiskCacheableMedia } from "@/lib/storage/media-cache.server";
import { fetchMediaResponse, parseAllowedMediaUrl } from "@/lib/upstream.server";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return undefined;
}

/** kami_danbooru 存的是 JSON（login + apiKey），解析失败按没填算。 */
function readDanbooru(header: string | null): { login: string; apiKey: string } | undefined {
  const raw = readCookie(header, "kami_danbooru");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { login?: unknown; apiKey?: unknown };
    const login = typeof parsed.login === "string" ? parsed.login : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    if (!login || !apiKey) return undefined;
    return { login, apiKey };
  } catch {
    return undefined;
  }
}

function dropped(): Response {
  return new Response(null, { status: 204 });
}

export async function GET(request: Request) {
        if (request.signal.aborted) return dropped();
        const target = new URL(request.url).searchParams.get("u");
        if (!target) return new Response("missing url", { status: 400 });
        try {
          const parsed = parseAllowedMediaUrl(target);
          const cookieHeader = request.headers.get("cookie");
          const cookie = isDiskCacheableMedia(parsed) ? null : cookieHeader;
          const danbooru = readDanbooru(cookieHeader);
          return await fetchMediaResponse(
            target,
            {
              ...(cookie
                ? {
                    pixiv: readCookie(cookie, "kami_pixiv"),
                    fanbox: readCookie(cookie, "kami_fanbox"),
                  }
                : {}),
              danbooru,
            },
            request.signal,
          );
        } catch (err) {
          if (isAbortError(err) || request.signal.aborted) return dropped();
          const message = err instanceof Error ? err.message : "proxy error";
          return new Response(message, { status: 400 });
        }
}
