import { getActiveRequest } from "../request-context.ts";
import { auth, authConfigured } from "./server";

/**
 * Server-side session resolution (server-only).
 *
 * 本应用自己的 Better Auth 跑在同源 `/api/auth/*`，会话 cookie 随每个
 * 请求自动带上，所以直接从请求 cookie 经 `auth.api.getSession` 解析用户
 * （不需要客户端签发的 JWT）。永远不要信任客户端传来的 user id ——
 * 只信这里的验证结果。
 */

/** Re-export so callers can branch on it without importing `server.ts`. */
export { authConfigured };

/** Dev fallback user id, used only when auth is disabled (VITE_AUTH_ENABLED=false). */
export const DEV_USER_ID = "dev-user";

/**
 * Thrown by `requireUserId` when the caller has no valid session. Carries
 * `status: 401`; the message is a stable contract — match
 * `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; email: string | null };

/**
 * Resolve the signed-in user from the current request, or `null` when auth isn't
 * configured / nobody is signed in. Safe to call from server functions and SSR
 * loaders.
 */
export async function getSessionUser(): Promise<VerifiedUser | null> {
  if (!authConfigured) return null;
  const request = getActiveRequest();
  if (!request) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

/**
 * Resolve the current user id for a server function, or throw when unauthorized.
 * - Auth enabled -> the verified session user id; throws `UnauthorizedError`
 *   when signed out.
 * - Auth disabled (`VITE_AUTH_ENABLED=false`) + `DATABASE_URL` set -> throw (fail
 *   closed): one shared dev user on a real database would let every visitor
 *   read/write everyone's rows.
 * - Auth disabled + no database -> the shared dev user id.
 */
export async function requireUserId(): Promise<string> {
  if (!authConfigured) {
    if (process.env.DATABASE_URL?.trim()) {
      throw new Error(
        "Auth is disabled (VITE_AUTH_ENABLED=false) but DATABASE_URL is set — " +
          "refusing to fall back to the shared dev user against a real database.",
      );
    }
    return DEV_USER_ID;
  }
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}
