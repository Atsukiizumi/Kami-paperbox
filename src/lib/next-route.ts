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
 */
import { runWithRequest } from "./request-context.ts";
import { CrossSiteRequestError } from "./auth/isolation.server.ts";
import { UnauthorizedError } from "./auth/verify.server.ts";

export function withRequest<T>(fn: (request: Request) => T): (request: Request) => T {
  return (request: Request) => runWithRequest(request, () => fn(request));
}

export type DataPlaneGuest = boolean | "read";

export function withDataPlane(
  fn: (request: Request) => Response | Promise<Response>,
  opts: { guest?: DataPlaneGuest } = {},
): (request: Request) => Promise<Response> {
  return withRequest(async (request: Request): Promise<Response> => {
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
}
