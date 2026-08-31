import { createFileRoute } from "@tanstack/react-router";
import { cancelBrowserLogin, getLoginJob, startBrowserLogin } from "@/lib/browser-login.server";

function aborted(err: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  const message = "message" in err ? String((err as { message?: string }).message) : "";
  return name === "AbortError" || /operation was aborted/i.test(message);
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/login-browser")({
  server: {
    handlers: {
      GET: async () => json({ ok: true, ...getLoginJob() }),
      POST: async ({ request }) => {
        let body: { site?: unknown; action?: unknown } = {};
        try {
          body = (await request.json()) as { site?: unknown; action?: unknown };
        } catch {
          if (request.signal.aborted) return json({ ok: true, ...getLoginJob() });
          return json({ ok: false, status: "error", error: "无效的请求" }, 400);
        }
        try {
          if (body.action === "cancel") {
            return json({ ok: true, ...await cancelBrowserLogin() });
          }
          const site = body.site === "fanbox" ? "fanbox" : body.site === "pixiv" ? "pixiv" : null;
          if (!site) return json({ ok: false, status: "error", error: "请指定 pixiv 或 fanbox" }, 400);
          const session = await startBrowserLogin(site);
          const ok = session.status !== "error";
          return json({ ok, ...session }, ok ? 200 : 400);
        } catch (err) {
          if (aborted(err, request.signal)) {
            return json({ ok: true, ...getLoginJob() });
          }
          const message = err instanceof Error ? err.message : "登录失败";
          return json({ ok: false, status: "error", error: message }, 400);
        }
      },
    },
  },
});
