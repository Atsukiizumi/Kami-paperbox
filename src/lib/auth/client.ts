"use client";

/**
 * Better Auth client for this React SPA (browser-side).
 *
 * 作用：连本应用自己的 Better Auth（同源 /api/auth/*）。会话是 HttpOnly
 *      cookie，浏览器自动带；登录/注册入口在设置页（authClient.signIn /
 *      signUp.email），登出走下面的 signOut()。
 * 为什么单独导出 signOut 而不是直接用 authClient.signOut：裸调用后
 *      任何残留本地状态都会让用户「看起来还在登录」，要按顺序清干净。
 */
import { createAuthClient } from "better-auth/react";
import { runSignOut } from "../../../scripts/sign-out-plan.mjs";
import { publicEnv } from "../public-env";

export const authClient = createAuthClient();

/**
 * True when the account system should be shown — i.e. whenever
 * `VITE_AUTH_ENABLED` is not `"false"` (the Docker form bakes "false").
 */
export const authEnabled = publicEnv("VITE_AUTH_ENABLED") !== "false";

/**
 * Sign out of THIS app's session, then redirect.
 *
 * **Rejects if the server never confirms**: the session is an HttpOnly cookie
 * only the server can clear, so redirecting anyway would report a sign-out that
 * did not happen. Callers (e.g. `<UserButton />`) must catch and let the
 * visitor retry.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  await runSignOut({
    // Better Auth resolves with `{ error }` instead of rejecting, so surface a
    // failed response as a rejection for the sequence to act on.
    requestSignOut: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}
