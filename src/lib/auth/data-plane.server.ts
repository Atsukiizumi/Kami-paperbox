/**
 * 数据面访问闸（SEC-01/02/07 的接线点）。
 *
 * 作用：/api/* 数据面（纸匣、热榜、会话、代理、登录中转、上游读取、媒体）
 *      在进入业务逻辑前统一过闸：
 *      - 应用账号开启（authConfigured）→ 必须有有效会话；
 *      - 账号关闭 → 必须携带启动令牌（Authorization 头 / ?token= / 配对
 *        cookie 三选一，cookie 是 <img> 场景的主通道）。
 * 用法：路由侧只该碰 next-route.ts 的 withDataPlane 包装。
 * 为什么：服务绑定 0.0.0.0:8080，局域网内任意设备可直打 API；此前
 *        runAuth 已实现但零调用，全部端点裸奔（12 文档 SEC-01）。
 */
import { assertSameSiteRequest } from "./isolation.server.ts";
import { authConfigured, getSessionUser, UnauthorizedError } from "./verify.server.ts";
import {
  lanTokenFromRequest,
  lanTokenMatches,
  printLanPairingIntroOnce,
  readLanToken,
} from "./lan-token.server.ts";

/**
 * 统一闸门：Fetch-Metadata 同站校验（CSRF 层）→ 会话或启动令牌。
 * 不满足抛 UnauthorizedError（401）/ CrossSiteRequestError（403），
 * 由 withDataPlane 映射成 JSON 响应。
 *
 * guest（访客层）：应用账号开启但未登录时放行浏览、榜单、图片。登录中转
 * 和以图搜图不放行（会在本机拉起浏览器或把文件交给外部引擎）。公开接口另
 * 有进程内次数上限。Fetch-Metadata 同站校验对访客同样生效。
 */
export async function requireDataPlaneAccess(request: Request, opts: { guest?: boolean } = {}): Promise<void> {
  assertSameSiteRequest(request);
  if (authConfigured) {
    const user = await getSessionUser();
    if (!user && !opts.guest) throw new UnauthorizedError();
    return;
  }
  const provided = lanTokenFromRequest(request);
  if (!provided || !lanTokenMatches(provided, readLanToken())) {
    // 顺带打印一次配对指引：首个未带令牌的请求就是新设备/新浏览器到了。
    printLanPairingIntroOnce();
    throw new UnauthorizedError();
  }
}
