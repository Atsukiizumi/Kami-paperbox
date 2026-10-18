/**
 * 登录中转 HTTP。
 *
 * 作用：start / poll 帧 / 转发输入 / 取消。实现全在 browser-login.server.ts。
 * 用法：设置页 SessionRelayDialog fetch 本路由。
 * 安全：快照默认剥离 pixiv / fanbox / x 会话串（SEC-02）——280ms 轮询帧不带凭据；
 *      前端在 done 事件里用 ?credentials=1 单独取一次（本路由整体在数据面闸内）。
 *      relayToken 绑定（10-18 凭据竞态修复）：start 受理时签发 per-job token
 *      （randomBytes(32)），仅随 start 响应外发一次；此后帧轮询 / ?credentials=1 /
 *      input / cancel 一律第一步过 assertRelayToken，缺失或不符即 401 固定错误体
 *      （不消费凭据、不回帧、零副作用、不含 job 状态）。job 终态（done 消费 /
 *      error / cancel / 下一次 start）token 即失效；访客可 start 自己的 job 拿
 *      自己的 token（TD-20 语义不变），但抢不走别人 job 的任何东西。
 */
import {
  assertRelayToken,
  cancelBrowserLogin,
  consumeLoginJobCredentials,
  dispatchLoginInput,
  getLoginJob,
  startBrowserLogin,
  type StartLoginResult,
} from "@/lib/sync/browser-login.server";
import { parseLoginSite, type LoginInputEvent, type LoginJobSnapshot } from "@/lib/sync/browser-login";

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
  return { ...snap, pixiv: "", fanbox: "", x: "" };
}

/** relayToken 校验失败的 401 固定错误体：不含 job 状态 / 帧 / token——不给旁观者任何信息。 */
function relayUnauthorized() {
  return { ok: false, status: "error", error: "登录中转校验失败" };
}

/**
 * start 响应体：剥串快照 + relayToken 唯一一次外发（导出供路由单测锁形状）。
 * token 不在快照里（红线），只在此处显式拼一次；启动失败（error 已复位）得到空串。
 */
export function startLoginResponse(
  session: StartLoginResult,
): { ok: boolean } & LoginJobSnapshot & { relayToken: string } {
  const ok = session.snapshot.status !== "error";
  return { ok, ...stripCredentials(session.snapshot), relayToken: session.relayToken };
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
        // relayToken 门槛第一步：帧轮询与 ?credentials=1 都从 query 取；失败先于
        // 任何读取/消费返回，杜绝旁观者看帧、抢凭据。
        if (!assertRelayToken(url.searchParams.get("relayToken"))) {
          return json(relayUnauthorized(), 401);
        }
        const includeFrame = url.searchParams.get("frame") !== "0";
        // credentials=1：取走会话串并从内存清空（只交出这一次）
        if (url.searchParams.get("credentials") === "1") {
          return json({ ok: true, ...consumeLoginJobCredentials() });
        }
        return json({ ok: true, ...stripCredentials(getLoginJob(includeFrame)) });
}

export async function POST(request: Request) {
        let body: { site?: unknown; action?: unknown; event?: unknown; relayToken?: unknown } = {};
        try {
          body = (await request.json()) as { site?: unknown; action?: unknown; event?: unknown; relayToken?: unknown };
        } catch {
          // body 解不开就没有 token 可言：固定 400，不回 job 快照（原 abort 分支
          // 会带出状态，10-18 一并收紧为无状态固定体）。
          return json({ ok: false, status: "error", error: "无效的请求" }, 400);
        }
        const relayToken = typeof body.relayToken === "string" ? body.relayToken : null;
        try {
          if (body.action === "cancel") {
            if (!assertRelayToken(relayToken)) return json(relayUnauthorized(), 401);
            return json({ ok: true, ...stripCredentials(await cancelBrowserLogin()) });
          }
          if (body.action === "input") {
            if (!assertRelayToken(relayToken)) return json(relayUnauthorized(), 401);
            const event = parseInput(body.event);
            if (!event) return json({ ok: false, status: "error", error: "无效的输入" }, 400);
            return json({ ok: true, ...stripCredentials(await dispatchLoginInput(event)) });
          }
          const site = parseLoginSite(body.site);
          if (!site) return json({ ok: false, status: "error", error: "请指定 pixiv、fanbox 或 x" }, 400);
          // start 不需 token（TD-20 访客语义）；token 在响应里一次性下发。
          const session = await startBrowserLogin(site);
          const startBody = startLoginResponse(session);
          return json(startBody, startBody.ok ? 200 : 400);
        } catch (err) {
          if (aborted(err, request.signal)) {
            return json({ ok: true, ...stripCredentials(getLoginJob()) });
          }
          const message = err instanceof Error ? err.message : "登录失败";
          return json({ ok: false, status: "error", error: message }, 400);
        }
}
