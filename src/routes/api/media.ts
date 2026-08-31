/**
 * 图片代理。
 *
 * 作用：浏览器只请求本站 `/api/media?u=`，由服务端带 Referer/Cookie 去拉 pximg / fanbox。
 * 为什么：直接把 i.pximg.net 丢给 <img> 会 403。封面走流式 + 一周缓存。
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchMediaResponse } from "@/lib/upstream.server";

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

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("u");
        if (!target) return new Response("missing url", { status: 400 });
        const cookie = request.headers.get("cookie");
        try {
          return await fetchMediaResponse(target, {
            pixiv: readCookie(cookie, "kami_pixiv"),
            fanbox: readCookie(cookie, "kami_fanbox"),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "proxy error";
          return new Response(message, { status: 400 });
        }
      },
    },
  },
});
