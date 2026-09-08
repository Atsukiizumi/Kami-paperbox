/**
 * Auth helper for Route Handlers. Preview bearer still lives in `client.ts` —
 * send `Authorization: Bearer` (`authHeaders()`) when calling from the browser.
 *
 *   import { runAuth } from "@/lib/auth/middleware";
 *   export async function GET(request: Request) {
 *     const { userId } = await runAuth(request);
 *     ...
 *   }
 *
 * Signed out with auth on (live preview included) -> throws `UnauthorizedError`
 * (see `verify.server.ts`). With auth disabled (`VITE_AUTH_ENABLED=false`, the
 * shipped default) it resolves the shared dev user — but throws instead when a
 * `DATABASE_URL` is also set, so an app without sign-in must not use this at
 * all. On the auth-on path, use it on every handler that touches per-user data
 * and scope every query by `userId`.
 */
import { getBearerToken } from "./client";

/** Attach the live-preview bearer token. No-op when deployed (cookie auth). */
export function authHeaders(): HeadersInit {
  const token = getBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function bearerFrom(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header || !/^bearer\s+/i.test(header)) return undefined;
  const token = header.replace(/^bearer\s+/i, "").trim();
  return token || undefined;
}

/** Server: verify the caller. Pass the Route Handler Request. */
export async function runAuth(request: Request): Promise<{ userId: string }> {
  const { assertSameSiteRequest } = await import("./isolation.server");
  const { requireUserId } = await import("./verify.server");
  assertSameSiteRequest(request);
  const userId = await requireUserId(bearerFrom(request));
  return { userId };
}
