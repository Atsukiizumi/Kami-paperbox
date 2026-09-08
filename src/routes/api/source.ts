/**
 * 上游读接口 HTTP。Next 与 Vite 都打这里。
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchSchema } from "@/lib/source";
import type { FetchInput } from "@/lib/types";

export const Route = createFileRoute("/api/source")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.json();
          const data = fetchSchema.parse(raw) as FetchInput;
          const { dispatchFetch } = await import("@/lib/upstream.server");
          const body = await dispatchFetch(data);
          return Response.json(body, { headers: { "cache-control": "no-store" } });
        } catch (err) {
          const message = err instanceof Error ? err.message : "请求失败";
          return Response.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
