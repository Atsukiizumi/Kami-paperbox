import { Check, Plus, UserRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { SiteAvatar } from "@/components/site-avatar";
import { accountLabel, displayName, siteProfile } from "@/lib/accounts";
import { fanboxSessionFrom, isPixivLoggedInSession } from "@/lib/browser-login";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function AccountSwitcher() {
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const switchAccount = useSettings((s) => s.switchAccount);
  const refreshIdentities = useSettings((s) => s.refreshIdentities);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const active = accounts.find((a) => a.id === activeAccountId);
  const pixiv = siteProfile(active, "pixiv");
  const fanbox = siteProfile(active, "fanbox");
  const headline = pixiv?.name || fanbox?.name || active?.name || "未登录";

  const pixivOk = isPixivLoggedInSession(pixivCookie);
  useEffect(() => {
    if (!pixivOk && !fanboxCookie) return;
    const missing =
      (pixivOk && (!pixiv?.name || !pixiv?.avatar)) ||
      (fanboxCookie && (!fanbox?.name || !fanbox?.avatar));
    if (missing) void refreshIdentities().catch(() => undefined);
  }, [activeAccountId, pixivOk, fanboxCookie, pixiv?.name, pixiv?.avatar, fanbox?.name, fanbox?.avatar, refreshIdentities]);

  async function choose(id: string) {
    const next = accounts.find((a) => a.id === id);
    await switchAccount(id);
    await refreshIdentities().catch(() => undefined);
    toast.success(`已切换到 ${accountLabel(next) || next?.name || "账号"}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 max-w-[11rem] shrink-0 items-center gap-2 rounded-lg px-2 text-xs text-muted",
            "transition-colors hover:bg-elevated hover:text-fg",
          )}
        >
          <span className="flex -space-x-2">
            {pixivOk ? <SiteAvatar profile={pixiv} size="sm" /> : <UserRound className="size-4" />}
            {fanboxCookie ? <SiteAvatar profile={fanbox} size="sm" className="ring-2 ring-bg" /> : null}
          </span>
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="max-w-28 truncate text-fg">{headline}</span>
            <span className="max-w-28 truncate text-[10px] text-subtle">
              {pixivOk || fanboxCookie ? "已登录" : active ? "会话无效" : "未登录"}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>账号</DropdownMenuLabel>
        {accounts.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">还没有登录。公开内容可直接看。</p>
        ) : (
          accounts.map((acc) => (
            <DropdownMenuItem key={acc.id} onSelect={() => void choose(acc.id)}>
              {acc.id === activeAccountId ? (
                <Check className="size-4 text-accent" />
              ) : (
                <span className="size-4" />
              )}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex -space-x-1.5">
                  <SiteAvatar profile={siteProfile(acc, "pixiv")} size="sm" />
                  <SiteAvatar profile={siteProfile(acc, "fanbox")} size="sm" className="ring-2 ring-surface" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{acc.name}</span>
                  <span className="truncate text-[10px] text-subtle">
                    Pixiv {displayName(acc, "pixiv")}
                    {" · "}
                    FANBOX {displayName(acc, "fanbox")}
                  </span>
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Plus className="size-4" />
            管理账号
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
