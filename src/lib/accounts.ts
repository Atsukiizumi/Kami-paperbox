/**
 * 多账号结构。
 *
 * 作用：一个账号同时挂 Pixiv / FANBOX Cookie 和头像资料。
 * 用法：createAccount(name, pixiv, fanbox)；displayName(account, site) 给切换器显示。
 * 为什么：不要从这里 import browser-login（循环）。已登录判断用内联的 `数字ID_令牌` 正则。
 */
import type { SiteProfile } from "./site-identity";

export type Account = {
  id: string;
  name: string;
  pixivCookie: string;
  fanboxCookie: string;
  pixivProfile?: SiteProfile | null;
  fanboxProfile?: SiteProfile | null;
};

export function createAccount(name: string, pixivCookie = "", fanboxCookie = ""): Account {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `acc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    name: name.trim() || "未命名",
    pixivCookie: pixivCookie.trim(),
    fanboxCookie: fanboxCookie.trim(),
    pixivProfile: null,
    fanboxProfile: null,
  };
}

export function cookiesOf(
  accounts: Account[],
  activeId: string | null,
): { pixivCookie: string; fanboxCookie: string } {
  const acc = accounts.find((a) => a.id === activeId);
  return {
    pixivCookie: acc?.pixivCookie ?? "",
    fanboxCookie: acc?.fanboxCookie ?? "",
  };
}

export function migrateLegacySettings(persisted: {
  pixivCookie?: string;
  fanboxCookie?: string;
  accounts?: Account[];
  activeAccountId?: string | null;
}): { accounts: Account[]; activeAccountId: string | null } {
  if (persisted.accounts && persisted.accounts.length > 0) {
    const id =
      persisted.activeAccountId &&
      persisted.accounts.some((a) => a.id === persisted.activeAccountId)
        ? persisted.activeAccountId
        : persisted.accounts[0].id;
    return { accounts: persisted.accounts, activeAccountId: id };
  }
  const pixiv = persisted.pixivCookie?.trim() || "";
  const fanbox = persisted.fanboxCookie?.trim() || "";
  if (!pixiv && !fanbox) return { accounts: [], activeAccountId: null };
  const acc = createAccount("账号 1", pixiv, fanbox);
  return { accounts: [acc], activeAccountId: acc.id };
}

export function accountLabel(account: Account | undefined): string {
  if (!account) return "未登录";
  const pixiv = account.pixivProfile?.name;
  const fanbox = account.fanboxProfile?.name;
  if (pixiv && fanbox && pixiv !== fanbox) return `${pixiv} / ${fanbox}`;
  if (pixiv) return pixiv;
  if (fanbox) return fanbox;
  const bits: string[] = [];
  if (account.pixivCookie) bits.push("Pixiv");
  if (account.fanboxCookie) bits.push("FANBOX");
  return bits.length ? `${account.name} · ${bits.join("/")}` : account.name;
}

export function siteProfile(account: Account | undefined, site: "pixiv" | "fanbox") {
  if (!account) return undefined;
  return site === "pixiv" ? account.pixivProfile : account.fanboxProfile;
}

export function displayName(account: Account | undefined, site: "pixiv" | "fanbox"): string {
  if (!account) return "未登录";
  const name = siteProfile(account, site)?.name;
  if (name) return name;
  const loggedIn = /^\d{2,12}_[A-Za-z0-9]{16,}$/.test(
    account.pixivCookie.trim().replace(/^PHPSESSID=/i, ""),
  );
  if (site === "pixiv") {
    if (!account.pixivCookie) return "未登录";
    return loggedIn ? "已登录" : "会话无效";
  }
  const fanboxOk = /^\d{2,12}_[A-Za-z0-9]{16,}$/.test(
    account.fanboxCookie.trim().replace(/^FANBOXSESSID=/i, ""),
  );
  if (fanboxOk || loggedIn) return "已登录";
  return account.fanboxCookie ? "会话无效" : "未登录";
}
