import { createFileRoute } from "@tanstack/react-router";
import { captureBrowserLogin } from "@/lib/browser-login.server";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/login-browser")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { site?: unknown };
        try {
          body = (await request.json()) as { site?: unknown };
        } catch {
          return json({ ok: false, error: "无效的请求" }, 400);
        }
        const site = body.site === "fanbox" ? "fanbox" : body.site === "pixiv" ? "pixiv" : null;
        if (!site) return json({ ok: false, error: "请指定 pixiv 或 fanbox" }, 400);
        try {
          const session = await captureBrowserLogin(site);
          return json({ ok: true, ...session });
        } catch (err) {
          const message = err instanceof Error ? err.message : "登录失败";
          return json({ ok: false, error: message }, 400);
        }
      },
    },
  },
});
