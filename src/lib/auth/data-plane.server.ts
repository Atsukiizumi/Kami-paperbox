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
import { assertSameSiteRequest } from "./isolation.server";
import { authConfigured, getSessionUser, UnauthorizedError } from "./verify.server";
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
 */
export async function requireDataPlaneAccess(request: Request): Promise<void> {
  assertSameSiteRequest(request);
  if (authConfigured) {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();
    return;
  }
  const provided = lanTokenFromRequest(request);
  if (!provided || !lanTokenMatches(provided, readLanToken())) {
    // 顺带打印一次配对指引：首个未带令牌的请求就是新设备/新浏览器到了。
    printLanPairingIntroOnce();
    throw new UnauthorizedError();
  }
}
