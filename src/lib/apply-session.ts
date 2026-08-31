/**
 * 把登录结果写进当前账号。
 *
 * 作用：设置页和首次向导共用同一套写入，避免两处各判一次访客 Cookie。
 * 用法：await applyLoginSession({ pixiv, fanbox, pixivProfile })。
 */
import { isPixivLoggedInSession, parseCookieDump } from "./browser-login";
import { useSettings } from "./store";

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
  else if (data.pixiv) s.setFanboxCookie(data.pixiv);
  s.applyProfiles({ pixiv: data.pixivProfile, fanbox: data.fanboxProfile });
  if (!data.pixivProfile && !data.fanboxProfile) await s.refreshIdentities().catch(() => undefined);
  await s.syncSessions().catch(() => undefined);
  return { ok: true };
}

export async function applyCookieDump(raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseCookieDump(raw);
  if (!parsed.pixiv && !parsed.fanbox) {
    if (raw.trim() && !isPixivLoggedInSession(raw) && /phpsessid/i.test(raw)) {
      return { ok: false, error: "这是访客 Cookie（没有用户ID_令牌）。请先在 Pixiv 登录，再复制 PHPSESSID。" };
    }
    return { ok: false, error: "没有识别到 PHPSESSID / FANBOXSESSID。" };
  }
  return applyLoginSession(parsed);
}
