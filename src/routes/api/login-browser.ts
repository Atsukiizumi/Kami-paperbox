/**
 * 登录中转 HTTP。
 *
 * 作用：start / poll 帧 / 转发输入 / 取消。实现全在 browser-login.server.ts。
 * 用法：设置页 SessionRelayDialog fetch 本路由。
 * 安全：快照默认剥离 pixiv / fanbox 会话串（SEC-02）——280ms 轮询帧不带凭据；
 *      前端在 done 事件里用 ?credentials=1 单独取一次（本路由整体在数据面闸内）。
 */
import {
  cancelBrowserLogin,
  consumeLoginJobCredentials,
  dispatchLoginInput,
  getLoginJob,
  startBrowserLogin,
} from "@/lib/sync/browser-login.server";
import type { LoginInputEvent, LoginJobSnapshot } from "@/lib/sync/browser-login";

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

/** 轮询响应剥掉会话明文，只留身份展示用的 profile。 */
function stripCredentials(snap: LoginJobSnapshot): LoginJobSnapshot {
  return { ...snap, pixiv: "", fanbox: "" };
}

function parseInput(raw: unknown): LoginInputEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.type === "mouse") {
    const action = rec.action;
    if (action !== "pressed" && action !== "released" && action !== "moved" && action !== "wheel") return null;
    const x = Number(rec.x);
    const y = Number(rec.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      type: "mouse",
      action,
      x,
      y,
      button: Number(rec.button) || 0,
      deltaX: Number(rec.deltaX) || 0,
      deltaY: Number(rec.deltaY) || 0,
    };
  }
  if (rec.type === "key") {
    if (rec.action !== "down" && rec.action !== "up") return null;
    if (typeof rec.key !== "string" || !rec.key || rec.key.length > 40) return null;
    return { type: "key", action: rec.action, key: rec.key };
  }
  if (rec.type === "text") {
    if (typeof rec.text !== "string" || !rec.text || rec.text.length > 4000) return null;
    return { type: "text", text: rec.text };
  }
  return null;
}

export async function GET(request: Request) {
        const url = new URL(request.url);
        const includeFrame = url.searchParams.get("frame") !== "0";
        // credentials=1：取走会话串并从内存清空（只交出这一次）
        if (url.searchParams.get("credentials") === "1") {
          return json({ ok: true, ...consumeLoginJobCredentials() });
        }
        return json({ ok: true, ...stripCredentials(getLoginJob(includeFrame)) });
}

export async function POST(request: Request) {
        let body: { site?: unknown; action?: unknown; event?: unknown } = {};
        try {
          body = (await request.json()) as { site?: unknown; action?: unknown; event?: unknown };
        } catch {
          if (request.signal.aborted) return json({ ok: true, ...stripCredentials(getLoginJob()) });
          return json({ ok: false, status: "error", error: "无效的请求" }, 400);
        }
        try {
          if (body.action === "cancel") {
            return json({ ok: true, ...stripCredentials(await cancelBrowserLogin()) });
          }
          if (body.action === "input") {
            const event = parseInput(body.event);
            if (!event) return json({ ok: false, status: "error", error: "无效的输入" }, 400);
            return json({ ok: true, ...stripCredentials(await dispatchLoginInput(event)) });
          }
          const site = body.site === "fanbox" ? "fanbox" : body.site === "pixiv" ? "pixiv" : null;
          if (!site) return json({ ok: false, status: "error", error: "请指定 pixiv 或 fanbox" }, 400);
          const session = await startBrowserLogin(site);
          const ok = session.status !== "error";
          return json({ ok, ...stripCredentials(session) }, ok ? 200 : 400);
        } catch (err) {
          if (aborted(err, request.signal)) {
            return json({ ok: true, ...stripCredentials(getLoginJob()) });
          }
          const message = err instanceof Error ? err.message : "登录失败";
          return json({ ok: false, status: "error", error: message }, 400);
        }
}
