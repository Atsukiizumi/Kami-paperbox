/**
 * Next Route Handler 包装。
 *
 * withRequest：包一层当前 Request，给 auth / cookie 读。
 * withDataPlane：数据面 API 专用 —— 先过访问闸（应用账号会话或局域网
 * 启动令牌，见 auth/data-plane.server.ts），401/403 映射成 JSON。
 *
 * guest 选项（访客层）：应用账号开启但未登录的访客可用「公开内容面」——
 * 榜单 / 浏览 / 图片代理等不带个人数据的服务。个人面（纸匣、会话同步、
 * 登录中转等）不传 guest，仍要会话。账号关闭形态（LAN 令牌）不受影响。
 *
 * 请求 id（M2 可观测性）：每个数据面请求生成 8 字符短 id，经
 * AsyncLocalStorage 贯穿全部服务端日志（log.server.ts 自动附着），并在
 * 本包装返回的每个响应（成功 / 401 / 403 / 处理器自建的 4xx/5xx）上回传
 * X-Request-Id 头。未捕获异常仍抛给 Next 走其 500 页，那种响应带不了头。
 */
import { runWithRequest } from "./request-context.ts";
import { runWithRequestId } from "./request-context.server.ts";
import { CrossSiteRequestError } from "./auth/isolation.server.ts";
import { UnauthorizedError } from "./auth/verify.server.ts";

/** 8 字符足够一天内的请求量级对账，撞上时看时间戳也能区分。 */
function shortRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function withRequest<T>(fn: (request: Request) => T): (request: Request) => T {
  return (request: Request) => runWithRequest(request, () => fn(request));
}

export type DataPlaneGuest = boolean | "read";

export function withDataPlane(
  fn: (request: Request) => Response | Promise<Response>,
  opts: { guest?: DataPlaneGuest } = {},
): (request: Request) => Promise<Response> {
  return withRequest(async (request: Request): Promise<Response> => {
    const requestId = shortRequestId();
    // 响应头统一在返回前补写一处：成功、401/403 映射、处理器自建的
    // 400/502 都经过这里，避免逐个构造点贴头。
    const res = await runWithRequestId(requestId, async (): Promise<Response> => {
      try {
        const { requireDataPlaneAccess } = await import("./auth/data-plane.server");
        const guestOk = opts.guest === true || (opts.guest === "read" && request.method === "GET");
        await requireDataPlaneAccess(request, { guest: guestOk });
        return await fn(request);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: { "cache-control": "no-store" } },
          );
        }
        if (err instanceof CrossSiteRequestError) {
          return Response.json(
            { error: "Forbidden" },
            { status: 403, headers: { "cache-control": "no-store" } },
          );
        }
        throw err;
      }
    });
    res.headers.set("x-request-id", requestId);
    return res;
  });
}
