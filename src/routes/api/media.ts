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
