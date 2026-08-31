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
  if (site === "pixiv") return account.pixivCookie ? "已登录" : "未登录";
  return account.fanboxCookie ? "已登录" : "未登录";
}
