/**
 * 局域网配对令牌 —— 浏览器与服务端共享的常量和纯函数。
 *
 * 作用：应用账号关闭（VITE_AUTH_ENABLED=false，如 Docker 形态）时，数据面
 *      API 只认「启动时生成、打印在服务端终端的令牌」。
 * 用法：浏览器首次打开 http://<host>:8080/#pair=<token> 完成配对 —— 写
 *      SameSite=Strict cookie，此后 <img> 和 fetch 自动携带，零调用点改动；
 *      服务端在 data-plane.server.ts 从 header / query / cookie 三处取值比对。
 * 为什么：绑定 0.0.0.0 意味着局域网里任意设备都能直接打 /api/*（SEC-01），
 *        账号关闭时没有会话 cookie 可用，必须另有一道闸；令牌只进 hash
 *        （不会发到服务端日志），cookie 非 HttpOnly 但与既有凭据落点
 *        （SEC-03/04）同风险面，后续随凭据收敛一起处理。
 */

export const LAN_TOKEN_COOKIE = "kami_lan_token";
export const LAN_PAIRING_KEY = "pair";

/** 令牌格式（24 字节 base64url）。data-plane.server 生成物恒匹配。 */
export const LAN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function isValidLanTokenShape(token: string): boolean {
  return LAN_TOKEN_PATTERN.test(token);
}

// ── 以下仅在浏览器执行 ───────────────────────────────────────────────────────

export function hasLanTokenCookie(): boolean {
  if (typeof document === "undefined") return false;
  const prefix = `${LAN_TOKEN_COOKIE}=`;
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(prefix));
}

/** 配对成功返回 true；cookie 被禁用等场景返回 false，调用方走输入框兜底。 */
export function setLanTokenCookie(token: string): boolean {
  if (typeof document === "undefined") return false;
  document.cookie = `${LAN_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=31536000; samesite=strict`;
  return hasLanTokenCookie();
}

/** 从地址栏 #pair=<token>（或 &pair=）取令牌；hash 不进服务端日志。 */
export function pairingTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const match = new RegExp(`[#&]${LAN_PAIRING_KEY}=([A-Za-z0-9_-]+)`).exec(window.location.hash);
  return match ? match[1]! : null;
}

/** 配对后把 hash 里的令牌抹掉，避免留在地址栏 / 被复制外传。 */
export function stripPairingHash(): void {
  if (typeof window === "undefined") return;
  const cleaned = window.location.hash
    .split("&")
    .filter((part) => !part.startsWith(`${LAN_PAIRING_KEY}=`));
  const rest = cleaned.join("&").replace(/^#&/, "#");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${rest === "#" ? "" : rest}`);
}
