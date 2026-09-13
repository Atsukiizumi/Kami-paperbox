"use client";

/**
 * 顶栏右上角的账号入口。
 *
 * 作用：登录状态一眼可见——未登录是「登录」入口（弹窗里登录 / 注册应用账号），
 *       登录后显示邮箱；下拉里登出应用账号、切换本浏览器绑定的 Pixiv / FANBOX 图站账号。
 * 形态：`VITE_AUTH_ENABLED=false`（Docker 匿名形态）没有应用账号，退化为本地图站
 *       账号切换器（原 AccountSwitcher 行为）。
 * 为什么：应用账号登录入口原先只藏在设置页，顶上看不见；右上角是惯例位置。
 */
import { Check, LogOut, Plus, UserRound } from "lucide-react";
import { Link } from "@/lib/kami-link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SiteAvatar } from "@/components/site-avatar";
import { AppAccountSignInForm } from "@/components/app-account-signin";
import { accountLabel, displayName, siteProfile } from "@/lib/sync/accounts";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { fanboxSessionFrom, isPixivLoggedInSession } from "@/lib/sync/browser-login";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function AccountSwitcher() {
  if (!authEnabled) return <LocalAccountMenu />;
  return <AppAccountMenu />;
}

/** 应用账号形态：登录状态 + 登录入口 + 本机绑定的图站账号切换。 */
function AppAccountMenu() {
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user && !user.isDevFallback);
  const [signInOpen, setSignInOpen] = useState(false);

  if (!signedIn) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSignInOpen(true)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-xs text-muted",
            "transition-colors hover:bg-elevated hover:text-fg",
          )}
        >
          <UserRound className="size-4" />
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-fg">登录</span>
            <span className="text-[10px] text-subtle">{isPending ? "读取中…" : "应用账号"}</span>
          </span>
        </button>
        <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>登录应用账号</DialogTitle>
            <DialogDescription>
              纸匣自己的账号（邮箱 + 密码）。登录后设置会同步到本机服务端，换浏览器、换设备登录同一账号即可恢复。
            </DialogDescription>
            <AppAccountSignInForm onDone={() => setSignInOpen(false)} />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  const email = user?.primaryEmail ?? user?.displayName ?? user?.id ?? "";
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
          <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-medium text-bg">
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="max-w-28 truncate text-fg">{email}</span>
            <span className="max-w-28 truncate text-[10px] text-subtle">应用账号已登录</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="flex min-w-0 flex-col">
          <span className="text-subtle">应用账号</span>
          <span className="truncate font-normal text-fg">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void signOut().catch(() => undefined)}>
          <LogOut className="size-4" />
          登出
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>绑定的图站账号</DropdownMenuLabel>
        <SiteAccountItems />
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

/** 匿名形态（无应用账号）：只列本地图站账号，行为与旧版一致。 */
function LocalAccountMenu() {
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
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
        <SiteAccountItems emptyHint="还没有登录。公开内容可直接看。" />
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

/** 本机绑定的 Pixiv / FANBOX 账号列表（点击切换）。 */
function SiteAccountItems({ emptyHint = "还没有绑定。在设置里添加图站账号。" }: { emptyHint?: string }) {
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);

  async function choose(id: string) {
    const next = accounts.find((a) => a.id === id);
    const { refreshIdentities, switchAccount } = useSettings.getState();
    await switchAccount(id);
    await refreshIdentities().catch(() => undefined);
    toast.success(`已切换到 ${accountLabel(next) || next?.name || "账号"}`);
  }

  if (accounts.length === 0) {
    return <p className="px-2 py-2 text-xs text-muted">{emptyHint}</p>;
  }
  return (
    <>
      {accounts.map((acc) => (
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
      ))}
    </>
  );
}
