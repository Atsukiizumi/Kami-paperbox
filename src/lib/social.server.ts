/**
 * 红心 / 收藏 / 关注（服务端）。
 *
 * 作用：复打官网自己的 POST。Pixiv 要先从首页 HTML 抠 CSRF。
 * 用法：dispatchSocial，经 mutateSource。
 * 为什么：这些接口要 Origin + Cookie + token，只能服务端发。
 *        CSRF 现在藏在 meta-global-data（可能是实体编码），不能再用「只认十六进制」的旧正则。
 */
import { bookmarkTagsOf, extractPixivCsrfToken, pixivHtmlLooksLoggedOut } from "./social";
import type { SocialInput, SocialOk } from "./types";
import { outboundFetch } from "./curl-fetch.server";
import { fanboxCookieHeader, pixivCookieHeader, withPixivUserId } from "./browser-login";
import { parsePixivMe } from "./site-identity";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let pixivTokenCache: { cookie: string; token: string; at: number } | null = null;

async function pixivToken(cookie: string, hintPath?: string): Promise<string> {
  if (pixivTokenCache && pixivTokenCache.cookie === cookie && Date.now() - pixivTokenCache.at < 8 * 60 * 1000) {
    return pixivTokenCache.token;
  }
  const pages = [
    "https://www.pixiv.net/",
    hintPath,
    "https://www.pixiv.net/setting_user.php",
  ].filter((u, i, all): u is string => Boolean(u) && all.indexOf(u) === i);

  let lastHtml = "";
  for (const url of pages) {
    const res = await outboundFetch(url, {
      headers: withPixivUserId(
        {
          "User-Agent": UA,
          Cookie: cookie,
          Referer: "https://www.pixiv.net/",
          Accept: "application/json,text/html,*/*",
          "Accept-Language": "ja,en;q=0.8",
        },
        cookie,
      ),
      redirect: "follow",
    });
    const html = await res.text();
    lastHtml = html;
    const token = extractPixivCsrfToken(html);
    if (token) {
      pixivTokenCache = { cookie, token, at: Date.now() };
      return token;
    }
  }
  if (pixivHtmlLooksLoggedOut(lastHtml) || !parsePixivMe({}, lastHtml)) {
    throw new Error("无法取得 Pixiv 凭证，请重新登录");
  }
  throw new Error("无法解析 Pixiv CSRF，页面结构可能变了");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { raw: text };
  }
}

async function pixivJson(
  url: string,
  cookie: string,
  body: unknown,
  form = false,
  illustId?: string,
): Promise<Record<string, unknown>> {
  const token = await pixivToken(
    cookie,
    illustId ? `https://www.pixiv.net/artworks/${illustId}` : undefined,
  );
  const headers = withPixivUserId(
    {
      "User-Agent": UA,
      Cookie: cookie,
      Referer: "https://www.pixiv.net/",
      Origin: "https://www.pixiv.net",
      Accept: "application/json, text/plain, */*",
      "x-csrf-token": token,
    },
    cookie,
  );
  let payload: string;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body as Record<string, string>)) params.set(k, v);
    if (!params.has("tt")) params.set("tt", token);
    payload = params.toString();
  } else {
    headers["Content-Type"] = "application/json; charset=utf-8";
    payload = JSON.stringify(body);
  }
  const res = await outboundFetch(url, { method: "POST", headers, body: payload, redirect: "follow" });
  const json = await readJson(res);
  if (!res.ok || json.error === true) {
    throw new Error(typeof json.message === "string" && json.message ? json.message : "操作失败，请确认已登录");
  }
  return json;
}

async function fanboxForm(path: string, cookie: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await outboundFetch(`https://api.fanbox.cc/${path}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      Origin: "https://www.fanbox.cc",
      Referer: "https://www.fanbox.cc/",
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body,
    redirect: "follow",
  });
  const json = await readJson(res);
  if (!res.ok) throw new Error("FANBOX 操作失败，请确认已登录");
  return json;
}

export async function dispatchSocial(input: SocialInput): Promise<SocialOk> {
  const pixiv = pixivCookieHeader(input.pixivCookie);
  const fanbox = fanboxCookieHeader(input.fanboxCookie, input.pixivCookie);
  switch (input.op) {
    case "pixivLike": {
      if (!pixiv) throw new Error("需要登录 Pixiv");
      await pixivJson("https://www.pixiv.net/ajax/illusts/like", pixiv, { illust_id: input.id }, false, input.id);
      return { ok: true, liked: true };
    }
    case "pixivBookmark": {
      if (!pixiv) throw new Error("需要登录 Pixiv");
      if (input.on) {
        const json = await pixivJson(
          "https://www.pixiv.net/ajax/illusts/bookmarks/add",
          pixiv,
          {
            illust_id: input.id,
            restrict: 0,
            comment: "",
            tags: bookmarkTagsOf(input.tags ?? []),
          },
          false,
          input.id,
        );
        const body = (json.body && typeof json.body === "object" ? json.body : json) as Record<string, unknown>;
        const last = body.last_bookmark_id ?? body.lastBookmarkId ?? body.bookmarkId ?? body.id;
        return { ok: true, bookmarked: true, bookmarkId: last != null ? String(last) : undefined };
      }
      if (!input.bookmarkId) throw new Error("没有收藏记录");
      await pixivJson(
        "https://www.pixiv.net/ajax/illusts/bookmarks/delete",
        pixiv,
        {
          bookmarkIds: [input.bookmarkId],
        },
        false,
        input.id,
      );
      return { ok: true, bookmarked: false };
    }
    case "pixivFollow": {
      if (!pixiv) throw new Error("需要登录 Pixiv");
      if (input.on) {
        await pixivJson(
          "https://www.pixiv.net/bookmark_add.php",
          pixiv,
          { mode: "add", type: "user", user_id: input.userId, restrict: "0", format: "json" },
          true,
        );
        return { ok: true, followed: true };
      }
      await pixivJson(
        "https://www.pixiv.net/rpc_group_setting.php",
        pixiv,
        { mode: "del", type: "bookuser", "id[]": input.userId },
        true,
      );
      return { ok: true, followed: false };
    }
    case "fanboxLike": {
      if (!fanbox) throw new Error("需要登录 FANBOX");
      await fanboxForm("like.create", fanbox, { postId: input.id });
      return { ok: true, liked: true };
    }
    case "fanboxFollow": {
      if (!fanbox) throw new Error("需要登录 FANBOX");
      await fanboxForm(input.on ? "follow.create" : "follow.delete", fanbox, {
        creatorId: input.creatorId,
      });
      return { ok: true, followed: input.on };
    }
    default: {
      const _never: never = input;
      throw new Error(`未知操作: ${JSON.stringify(_never)}`);
    }
  }
}
