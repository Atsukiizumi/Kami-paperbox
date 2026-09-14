/**
 * 把登录结果写进当前账号。
 *
 * 作用：设置页和首次向导共用同一套写入，避免两处各判一次访客 Cookie。
 * 用法：await applyLoginSession({ pixiv, fanbox, pixivProfile })；
 *      applyCookieDump(raw) 全量识别；applyCookieDump(raw, "pixiv"|"fanbox")
 *      只写指定站——设置页两个框各粘各的，互不串值。
 * 为什么：Pixiv / FANBOX 两站独立保存。FANBOX 框留空时由请求层
 *        fanboxCookieHeader(fanbox, pixiv) 回退复用 Pixiv 会话（同一账号体系，
 *        见 pixiv-auth.md §5），所以存储层不做任何跨站复制——复制只会让
 *        「一个框填了、另一个框跟着变」，用户分不清哪框是哪站。
 */
import {
  fanboxSessionValue,
  isFanboxLoggedInSession,
  isPixivLoggedInSession,
  parseCookieDump,
  pixivSessionValue,
  type LoginSite,
} from "./browser-login.ts";
import { useSettings } from "../store.ts";

export type LoginSessionInput = {
  pixiv?: string;
  fanbox?: string;
  pixivProfile?: { id: string; name: string; avatar?: string } | null;
  fanboxProfile?: { id: string; name: string; avatar?: string } | null;
  accountName?: string;
};

export async function applyLoginSession(data: LoginSessionInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = useSettings.getState();
  if (!s.activeAccountId) s.addAccount(data.accountName?.trim() || `账号 ${s.accounts.length + 1}`);
  if (data.pixiv && !isPixivLoggedInSession(data.pixiv)) {
    return { ok: false, error: "抓到的是访客 Cookie，还没有真正登录。" };
  }
  if (data.pixiv) s.setPixivCookie(data.pixiv);
  if (data.fanbox) s.setFanboxCookie(data.fanbox);
  s.applyProfiles({ pixiv: data.pixivProfile, fanbox: data.fanboxProfile });
  if (!data.pixivProfile && !data.fanboxProfile) await s.refreshIdentities().catch(() => undefined);
  await s.syncSessions().catch(() => undefined);
  return { ok: true };
}

export async function applyCookieDump(
  raw: string,
  site?: LoginSite,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseCookieDump(raw);
  if (site === "pixiv" || site === "fanbox") {
    // 定向粘贴：结构化导出里取本站字段；裸值按「粘在哪个框就是哪个站」解释。
    let value = site === "pixiv" ? parsed.pixiv : parsed.fanbox;
    if (!value) {
      const bare = site === "pixiv" ? pixivSessionValue(raw) : fanboxSessionValue(raw);
      const loggedIn = site === "pixiv" ? isPixivLoggedInSession(bare) : isFanboxLoggedInSession(bare);
      if (loggedIn) value = bare;
    }
    if (!value) {
      const other = site === "pixiv" ? parsed.fanbox : parsed.pixiv;
      if (other) {
        return {
          ok: false,
          error:
            site === "pixiv"
              ? "这串是 FANBOX 的 Cookie——请粘到 FANBOX 框里。"
              : "这串是 Pixiv 的 Cookie——请粘到 Pixiv 框里。",
        };
      }
      if (raw.trim() && !isPixivLoggedInSession(raw) && /sessid/i.test(raw)) {
        return { ok: false, error: "这是访客 Cookie（没有用户ID_令牌）。请先登录，再复制会话。" };
      }
      return { ok: false, error: "没有识别到 PHPSESSID / FANBOXSESSID。" };
    }
    return applyLoginSession(site === "pixiv" ? { pixiv: value } : { fanbox: value });
  }
  if (!parsed.pixiv && !parsed.fanbox) {
    if (raw.trim() && !isPixivLoggedInSession(raw) && /phpsessid/i.test(raw)) {
      return { ok: false, error: "这是访客 Cookie（没有用户ID_令牌）。请先在 Pixiv 登录，再复制 PHPSESSID。" };
    }
    return { ok: false, error: "没有识别到 PHPSESSID / FANBOXSESSID。" };
  }
  return applyLoginSession(parsed);
}
