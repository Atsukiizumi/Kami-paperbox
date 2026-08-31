import { createFileRoute } from "@tanstack/react-router";
import { resolveIdentities } from "@/lib/site-identity.server";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/whoami")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { pixiv?: unknown; fanbox?: unknown };
        try {
          body = (await request.json()) as { pixiv?: unknown; fanbox?: unknown };
        } catch {
          return json({ ok: false, error: "无效的请求" }, 400);
        }
        const pixiv = typeof body.pixiv === "string" ? body.pixiv : "";
        const fanbox = typeof body.fanbox === "string" ? body.fanbox : "";
        const profiles = await resolveIdentities({ pixiv, fanbox });
        return json({ ok: true, ...profiles });
      },
    },
  },
});
