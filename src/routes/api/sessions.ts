/**
 * 登录 Cookie HTTP。
 *
 * 作用：把 Pixiv / FANBOX 会话写成 HttpOnly Cookie。Next 走 cookies()，Vite 走 Set-Cookie。
 * 用法：saveSessions → POST /api/sessions
 */
import { sessionSchema } from "@/lib/source";
import { kamiSessionCookies, kamiSessionSetCookieHeader } from "@/lib/sync/session-cookies.server";

function isNextRuntime() {
  return Boolean(process.env.NEXT_RUNTIME) || Boolean(process.env.NEXT_PHASE);
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "无效的请求" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const data = sessionSchema.parse(raw);
  const list = kamiSessionCookies(data);

  if (isNextRuntime()) {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    for (const cookie of list) {
      jar.set({
        name: cookie.name,
        value: cookie.value,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        maxAge: cookie.maxAge,
      });
    }
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of list) {
    headers.append("Set-Cookie", kamiSessionSetCookieHeader(cookie));
  }
  return Response.json({ ok: true }, { headers });
}
