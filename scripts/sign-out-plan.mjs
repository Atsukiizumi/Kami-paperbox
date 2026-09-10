// @ts-check
/**
 * `src/lib/auth/client.ts` 的登出时序，独立成纯模块以便单测
 * （node --test 只扫 scripts/），和 migration-plan.mjs 的拆法一致。
 *
 * 会话是 HttpOnly cookie，JS 删不掉 —— 只有服务端完成的登出响应才能真正
 * 清掉它，且 server.ts 开了 session.cookieCache（maxAge 300），超时后
 * /get-session 还会靠缓存 cookie 应答几分钟。所以超时直接抛错而不是假装
 * 登出成功；拿不到响应的登出等于没发生，让用户重试。
 */

/**
 * 有界但宽松：只有服务端能终结会话。同源 POST 通常几十毫秒就回；
 * 10 秒还没回的登出不会成功。@type {number}
 */
export const SIGN_OUT_TIMEOUT_MS = 10_000;

/**
 * Run `start()` but give up after `timeoutMs`, reporting which happened. Never
 * rejects — callers decide what a failure means, and a `try/catch` around an
 * `await` does nothing for a promise that never settles.
 * @param {() => unknown} start
 * @param {number} timeoutMs
 * @returns {Promise<"ok" | "failed" | "timeout">}
 */
export function settleWithin(start, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    /** @param {"ok" | "failed"} outcome */
    const done = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    try {
      Promise.resolve(start()).then(
        () => done("ok"),
        () => done("failed"),
      );
    } catch {
      done("failed");
    }
  });
}

/**
 * @typedef {object} SignOutSteps
 * @property {() => unknown} requestSignOut Ask the server to end the session; must reject on a failed response.
 * @property {() => void} redirect Leave the page.
 * @property {number} [timeoutMs]
 */

/**
 * End the session server-side, then redirect.
 *
 * 服务端不确认就抛错（此时用户仍在登录），绝不静默跳转。
 * @param {SignOutSteps} steps
 * @returns {Promise<void>}
 */
export async function runSignOut({ requestSignOut, redirect, timeoutMs }) {
  const outcome = await settleWithin(requestSignOut, timeoutMs ?? SIGN_OUT_TIMEOUT_MS);
  if (outcome !== "ok") {
    throw new Error(
      outcome === "timeout"
        ? "Sign-out timed out — you are still signed in. Please try again."
        : "Sign-out failed — you are still signed in. Please try again.",
    );
  }
  redirect();
}
