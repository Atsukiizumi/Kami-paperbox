/**
 * 登录 Cookie HTTP。
 *
 * 作用：把 Pixiv / FANBOX 会话写成 HttpOnly Cookie。Next 走 cookies()，Vite 走 Set-Cookie。
 * 用法：saveSessions → POST /api/sessions
 *
 * 访客（应用账号开启但未登录）只写自己浏览器的 cookie 镜像：合并基线是
 * 请求带来的镜像而不是共享 store，不落盘；switch/drop 涉及服务端账号，
 * 一律 403。已登录（或账号关闭的 LAN 令牌形态）才动 .data 的账号库。
 * switch 到服务端没有的账号 404——不用空凭据把当前浏览器的登录盖掉。
 */
import { sessionSchema } from "@/lib/source";
import { runWithRequest } from "@/lib/request-context";
import { credentialTag } from "@/lib/sync/cred-tag";
import {
  kamiSessionCookies,
  kamiSessionSetCookieHeader,
  readMirroredSiteSecrets,
} from "@/lib/sync/session-cookies.server";
import {
  SiteSessionsCorruptError,
  deleteAccountSecrets,
  emptySiteSecrets,
  mergeSiteSecrets,
  readAccountSecrets,
  writeAccountSecrets,
  type SiteSecrets,
} from "@/lib/sync/site-sessions.server";

function isNextRuntime() {
  return Boolean(process.env.NEXT_RUNTIME) || Boolean(process.env.NEXT_PHASE);
}

function tagsOf(secrets: SiteSecrets) {
  return {
    ok: true as const,
    pixivTag: credentialTag(secrets.pixiv),
    fanboxTag: credentialTag(secrets.fanbox),
    xTag: credentialTag(secrets.x),
    danbooruTag: credentialTag(secrets.danbooruApiKey),
  };
}

function fail(error: string, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

/** save 的合并基线：读损坏按空算（writeAccountSecrets 会以重置语义写回）。 */
function readForSave(accountId: string): SiteSecrets {
  try {
    return readAccountSecrets(accountId) ?? emptySiteSecrets();
  } catch (err) {
    if (err instanceof SiteSessionsCorruptError) return emptySiteSecrets();
    throw err;
  }
}

/** 应用账号开启时要有会话才动服务端账号库；账号关闭（LAN 令牌）形态恒真。 */
async function hasServerAccountAccess(request: Request): Promise<boolean> {
  return runWithRequest(request, async () => {
    const { authConfigured, getSessionUser } = await import("@/lib/auth/verify.server");
    if (!authConfigured) return true;
    return Boolean(await getSessionUser());
  });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("无效的请求", 400);
  }
  let data: ReturnType<typeof sessionSchema.parse>;
  try {
    data = sessionSchema.parse(raw);
  } catch {
    return fail("无效的请求", 400);
  }
  const body = raw as Record<string, unknown>;
  const accountId = data.accountId?.trim() || "default";
  const authed = await hasServerAccountAccess(request);
  const secure = new URL(request.url).protocol === "https:";
  const sitePatch: Partial<SiteSecrets> = {};
  const danbooruPatch: Partial<SiteSecrets> = {};
  if ("pixiv" in body) sitePatch.pixiv = data.pixiv ?? "";
  if ("fanbox" in body) sitePatch.fanbox = data.fanbox ?? "";
  if ("x" in body) sitePatch.x = data.x ?? "";
  if ("danbooruLogin" in body) danbooruPatch.danbooruLogin = data.danbooruLogin ?? "";
  if ("danbooruApiKey" in body) danbooruPatch.danbooruApiKey = data.danbooruApiKey ?? "";

  let stored: SiteSecrets;
  if (data.action === "drop") {
    if (!authed) return fail("访客不能删除服务端保存的账号", 403);
    deleteAccountSecrets(accountId);
    // 只有删的是当前账号时客户端才带 clearMirror：镜像跟着一起清，别的账号不受牵连
    if (!data.clearMirror) return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    stored = emptySiteSecrets();
  } else if (!authed) {
    if (data.action === "switch") return fail("访客不能切换账号，请先登录应用账号", 403);
    const mirrored = readMirroredSiteSecrets(request.headers.get("cookie"));
    const danbooru = mergeSiteSecrets(
      { ...emptySiteSecrets(), danbooruLogin: mirrored.danbooruLogin, danbooruApiKey: mirrored.danbooruApiKey },
      danbooruPatch,
    );
    stored = {
      ...mergeSiteSecrets(mirrored, sitePatch),
      danbooruLogin: danbooru.danbooruLogin,
      danbooruApiKey: danbooru.danbooruApiKey,
    };
  } else if (data.action === "switch") {
    try {
      const existing = readAccountSecrets(accountId);
      if (!existing) return fail("服务端没有该账号的凭据，请重新登录", 404);
      stored = existing;
    } catch (err) {
      if (err instanceof SiteSessionsCorruptError) return fail("本机凭据存储已损坏，请到设置里重新保存凭据", 500);
      throw err;
    }
  } else {
    stored = mergeSiteSecrets(readForSave(accountId), sitePatch);
    writeAccountSecrets(accountId, stored);
    const danbooru = mergeSiteSecrets(readForSave("__danbooru__"), danbooruPatch);
    if (Object.keys(danbooruPatch).length > 0) writeAccountSecrets("__danbooru__", danbooru);
    stored = { ...stored, danbooruLogin: danbooru.danbooruLogin, danbooruApiKey: danbooru.danbooruApiKey };
  }
  const list = kamiSessionCookies(stored);
  const payload = data.action === "drop" ? { ok: true as const } : tagsOf(stored);

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
        secure,
        maxAge: cookie.maxAge,
      });
    }
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of list) {
    headers.append("Set-Cookie", kamiSessionSetCookieHeader(cookie, secure));
  }
  return Response.json(payload, { headers });
}
