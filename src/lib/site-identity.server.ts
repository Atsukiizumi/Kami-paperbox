/**
 * 登录身份探测（服务端）。
 *
 * 作用：用当前 Cookie 打 self/status、user.info，失败再 parse HTML。
 * 用法：/api/whoami → resolveIdentities。
 */
import { outboundFetch } from "./curl-fetch.server";
import { pixivCookieHeader, fanboxCookieHeader, withPixivUserId } from "./browser-login";
import { parseFanboxMe, parsePixivMe, type SiteProfile } from "./site-identity";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function fetchPixivProfile(cookie?: string): Promise<SiteProfile | null> {
  const header = pixivCookieHeader(cookie);
  if (!header) return null;
  const headers = withPixivUserId(
    {
      "User-Agent": UA,
      Cookie: header,
      Referer: "https://www.pixiv.net/",
      Accept: "application/json,text/html,*/*",
    },
    header,
  );
  let profile: SiteProfile | null = null;
  try {
    const ajax = await outboundFetch("https://www.pixiv.net/touch/ajax/user/self/status", { headers });
    if (ajax.ok) profile = parsePixivMe(await readJson(ajax));
  } catch {
    /* homepage fallback */
  }
  if (!profile) {
    try {
      const home = await outboundFetch("https://www.pixiv.net/", { headers });
      profile = parsePixivMe({}, await home.text());
    } catch {
      profile = null;
    }
  }
  if (profile?.id && !profile.avatar) {
    try {
      const full = await outboundFetch(`https://www.pixiv.net/ajax/user/${profile.id}?full=1`, { headers });
      if (full.ok) {
        const richer = parsePixivMe(await readJson(full));
        if (richer?.avatar) profile = { ...profile, avatar: richer.avatar, name: richer.name || profile.name };
      }
    } catch {
      /* keep name without avatar */
    }
  }
  return profile;
}

export async function fetchFanboxProfile(cookie?: string): Promise<SiteProfile | null> {
  const header = fanboxCookieHeader(cookie);
  if (!header) return null;
  const headers = {
    "User-Agent": UA,
    Cookie: header,
    Origin: "https://www.fanbox.cc",
    Referer: "https://www.fanbox.cc/",
    Accept: "application/json,text/html,*/*",
  };
  try {
    const ajax = await outboundFetch("https://api.fanbox.cc/user.info", { headers });
    if (ajax.ok) {
      const parsed = parseFanboxMe(await readJson(ajax));
      if (parsed) return parsed;
    }
  } catch {
    /* homepage fallback */
  }
  try {
    const home = await outboundFetch("https://www.fanbox.cc/", { headers });
    const html = await home.text();
    return parseFanboxMe({}, html);
  } catch {
    return null;
  }
}

export async function resolveIdentities(input: { pixiv?: string; fanbox?: string }): Promise<{
  pixiv: SiteProfile | null;
  fanbox: SiteProfile | null;
}> {
  const [pixiv, fanbox] = await Promise.all([
    fetchPixivProfile(input.pixiv),
    fetchFanboxProfile(input.fanbox || input.pixiv),
  ]);
  return { pixiv, fanbox };
}
