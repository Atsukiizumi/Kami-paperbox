import { getActiveRequest } from "../request-context.ts";

/**
 * Fetch-Metadata sibling isolation — **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file reads the current Request from
 * request-context (Next). If it is imported from a dual client/server module
 * under a non-`.server` name, the bundler can ship Node-only code to the browser.
 *
 * Fetch-Metadata 同站校验：别的网站发起的脚本化请求（fetch/XHR/form POST）
 * 携带 SameSite=Lax 会话 cookie 时会被 403。本机 / 局域网自托管形态下，
 * 这一道挡的是「恶意网页让访客浏览器偷偷打本应用 API」的跨站脚本路径；
 * 直连 API 的局域网设备由数据面闸（会话 / 启动令牌）负责拦。
 *
 * 放行：同源请求（应用自己的前端）、非浏览器请求（SSR / 服务间，
 * 无 Sec-Fetch-Site 头）、顶层 GET 导航（正常打开页面）。其余跨站
 * 脚本化请求一律拒绝；在 withDataPlane（next-route.ts）强制执行。
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

function resolveRequest(explicit?: Request): Request | undefined {
  if (explicit) return explicit;
  return getActiveRequest();
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(request?: Request): void {
  const req = resolveRequest(request);
  if (!req) return; // no request context (e.g. build) — nothing to guard
  const h = req.headers;
  const site = h.get("sec-fetch-site");
  // Non-browser client (no header), the app's own origin, or a direct
  // (address-bar/bookmark) load are all fine.
  if (!site || site === "same-origin" || site === "none") return;
  // A top-level GET navigation (e.g. the broker's OAuth callback redirect) is
  // fine even when it's cross-site; scripted requests never set navigate mode.
  const dest = h.get("sec-fetch-dest");
  const isTopLevelGet =
    h.get("sec-fetch-mode") === "navigate" &&
    req.method === "GET" &&
    dest !== "object" &&
    dest !== "embed";
  if (isTopLevelGet) return;
  throw new CrossSiteRequestError();
}
