export type Account = {
  id: string;
  name: string;
  pixivCookie: string;
  fanboxCookie: string;
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
  const bits: string[] = [];
  if (account.pixivCookie) bits.push("Pixiv");
  if (account.fanboxCookie) bits.push("FANBOX");
  return bits.length ? `${account.name} · ${bits.join("/")}` : account.name;
}
