import { bookmarkTagsOf } from "./social";
import type { SocialInput, SocialOk } from "./types";
import { outboundFetch } from "./curl-fetch.server";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let pixivTokenCache: { cookie: string; token: string; at: number } | null = null;

function pixivCookieHeader(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return v.toLowerCase().startsWith("phpsessid=") ? v : `PHPSESSID=${v}`;
}

function fanboxCookieHeader(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return v.toLowerCase().startsWith("fanboxsessid=") ? v : `FANBOXSESSID=${v}`;
}

async function pixivToken(cookie: string): Promise<string> {
  if (pixivTokenCache && pixivTokenCache.cookie === cookie && Date.now() - pixivTokenCache.at < 8 * 60 * 1000) {
    return pixivTokenCache.token;
  }
  const res = await outboundFetch("https://www.pixiv.net/", {
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      Referer: "https://www.pixiv.net/",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  const html = await res.text();
  const m =
    html.match(/"token"\s*:\s*"([a-f0-9]{16,})"/i) ||
    html.match(/pixiv\.context\.token\s*=\s*"([^"]+)"/) ||
    html.match(/name="csrf-token"\s+content="([^"]+)"/);
  if (!m?.[1]) throw new Error("无法取得 Pixiv 凭证，请重新登录");
  pixivTokenCache = { cookie, token: m[1], at: Date.now() };
  return m[1];
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
): Promise<Record<string, unknown>> {
  const token = await pixivToken(cookie);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Cookie: cookie,
    Referer: "https://www.pixiv.net/",
    Origin: "https://www.pixiv.net",
    Accept: "application/json, text/plain, */*",
    "x-csrf-token": token,
  };
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
  const fanbox = fanboxCookieHeader(input.fanboxCookie);
  switch (input.op) {
    case "pixivLike": {
      if (!pixiv) throw new Error("需要登录 Pixiv");
      await pixivJson("https://www.pixiv.net/ajax/illusts/like", pixiv, { illust_id: input.id });
      return { ok: true, liked: true };
    }
    case "pixivBookmark": {
      if (!pixiv) throw new Error("需要登录 Pixiv");
      if (input.on) {
        const json = await pixivJson("https://www.pixiv.net/ajax/illusts/bookmarks/add", pixiv, {
          illust_id: input.id,
          restrict: 0,
          comment: "",
          tags: bookmarkTagsOf(input.tags ?? []),
        });
        const body = (json.body && typeof json.body === "object" ? json.body : json) as Record<string, unknown>;
        const last = body.last_bookmark_id ?? body.lastBookmarkId ?? body.bookmarkId ?? body.id;
        return { ok: true, bookmarked: true, bookmarkId: last != null ? String(last) : undefined };
      }
      if (!input.bookmarkId) throw new Error("没有收藏记录");
      await pixivJson("https://www.pixiv.net/ajax/illusts/bookmarks/delete", pixiv, {
        bookmarkIds: [input.bookmarkId],
      });
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
