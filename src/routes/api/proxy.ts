import { createFileRoute } from "@tanstack/react-router";
import { probeProxy } from "@/lib/curl-fetch.server";
import { clearSavedProxy, readProxyState, saveProxyUrl } from "@/lib/proxy.server";
import { maskProxyUrl, parseProxyUrl } from "@/lib/proxy-url";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function publicState() {
  const state = readProxyState();
  return {
    url: state.url,
    display: maskProxyUrl(state.url),
    source: state.source,
    enabled: Boolean(state.url),
  };
}

function fail(err: unknown, fallback = "保存失败") {
  return json({ ok: false, error: err instanceof Error ? err.message : fallback }, 500);
}

export const Route = createFileRoute("/api/proxy")({
  server: {
    handlers: {
      GET: async () => json(publicState()),
      POST: async ({ request }) => {
        let body: { url?: unknown; probe?: unknown; clear?: unknown };
        try {
          body = (await request.json()) as { url?: unknown; probe?: unknown; clear?: unknown };
        } catch {
          return json({ ok: false, error: "无效的请求" }, 400);
        }
        if (body.probe === true) {
          let proxy = readProxyState().url;
          if (typeof body.url === "string") {
            const parsed = parseProxyUrl(body.url);
            if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
            proxy = parsed.href;
          }
          if (!proxy) return json({ ok: false, error: "还没有填写代理地址" }, 400);
          const probe = await probeProxy("https://www.pixiv.net/", proxy);
          return json({
            ok: probe.ok,
            url: proxy,
            display: maskProxyUrl(proxy),
            source: readProxyState().source,
            enabled: true,
            probe,
          });
        }
        try {
          if (body.clear === true || body.url === "") {
            clearSavedProxy();
            return json({ ok: true, ...publicState() });
          }
          if (typeof body.url !== "string") {
            return json({ ok: false, error: "请填写代理地址" }, 400);
          }
          const parsed = parseProxyUrl(body.url);
          if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
          if (!parsed.href) {
            clearSavedProxy();
            return json({ ok: true, ...publicState() });
          }
          saveProxyUrl(parsed.href);
          return json({ ok: true, ...publicState() });
        } catch (err) {
          return fail(err);
        }
      },
    },
  },
});
