"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, usePathname } from "@/lib/kami-link";
import { AccountSwitcher } from "@/components/account-switcher";
import { SiteSwitcher } from "@/components/site-switcher";
import { Archive, Bell, BookOpen, Clock, Compass, ListOrdered, PanelLeft, ScanSearch, Settings, Trophy } from "lucide-react";
import { toast } from "sonner";
import { canPickFolder, folderHealth, type FolderHealth } from "@/lib/folder-access";
import { playEnter } from "@/lib/motion";
import { mirrorQueueAcrossTabs, resumeQueue } from "@/lib/queue-runner";
import { useVaultIndex } from "@/lib/storage/vault-index";
import { useWatchBadge } from "@/lib/watch-badge";
import { cn } from "@/lib/utils";
import { onPersisted, useQueue, useSettings } from "@/lib/store";
import { warmPixivCsrf } from "@/lib/source";
import { ThemeMenu } from "@/components/settings/appearance";
import { Onboarding } from "@/components/onboarding";
import { DropToSearch } from "@/components/drop-to-search";
import { PaperMark } from "@/components/paper-mark";
import { DetailNav } from "@/components/back-to-browse";
import { isBrowsePath, isDeskPath, isDetailPath, isMainNavPath, isWorkPath, navItemActive } from "@/lib/route-shape";
import dynamic from "next/dynamic";
// PER-13：浏览是 778 行大组件，静态 import 会让所有路由都背它的 bundle——
// 拆成按需 chunk。keep-alive 隐藏挂载的行为不变，只是首帧变成异步加载。
const BrowsePage = dynamic(() => import("@/routes/browse").then((m) => m.Home));
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";

const NAV = [
  { to: "/", label: "案头", icon: BookOpen },
  { to: "/browse", label: "浏览", icon: Compass },
  { to: "/watch", label: "追踪", icon: Bell },
  { to: "/rankings", label: "热榜", icon: Trophy },
  { to: "/history", label: "历史", icon: Clock },
  { to: "/search", label: "搜图", icon: ScanSearch },
  { to: "/queue", label: "队列", icon: ListOrdered },
  { to: "/vault", label: "纸匣", icon: Archive },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

/** 移动端底部栏固定六格；队列与追踪只在桌面侧栏/顶栏出现，塞七项会挤爆网格。 */
const MOBILE_NAV = NAV.filter((item) => item.to !== "/" && item.to !== "/queue" && item.to !== "/watch");

function LogoMark({ className }: { className?: string }) {
  return <PaperMark className={className} />;
}

/** 文件夹预检提示语：按病因给一句人话，去设置重新选即可恢复。 */
const FOLDER_HEALTH_HINT: Record<Exclude<FolderHealth, "ok">, string> = {
  none: "这台浏览器还没有授权过文件夹（设置随账号同步，文件夹授权不跟设备）",
  prompt: "浏览器要求重新授权，后台下载会静默退回应用内存储",
  denied: "文件夹授权被拒绝",
  unreadable: "文件夹可能已被删除或移动",
};

/** 启动时预检下载文件夹（一次）：设置里选过且开着镜像/下载、但句柄读不出来
 *  就提示去设置——否则收藏一直悄悄落回浏览器存储，用户要翻库才发现。 */
async function warnFolderIfBroken(goSettings: () => void) {
  try {
    const s = useSettings.getState();
    if (!canPickFolder() || !s.folderLabel || (!s.downloadToFolder && !s.vaultMirrorFolder)) return;
    const health = await folderHealth();
    if (health === "ok") return;
    toast.message(`下载文件夹「${s.folderLabel}」访问不到`, {
      id: "kami-folder-health",
      description: `${FOLDER_HEALTH_HINT[health]}。收入纸匣和下载会退回应用内存储。`,
      action: { label: "去设置", onClick: goSettings },
    });
  } catch {
    /* 预检失败不打断启动 */
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigate = useNavigate();
  const queued = useQueue((s) => s.items.filter((i) => i.status !== "done").length);
  const watchBadge = useWatchBadge((s) => s.newCount);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => mirrorQueueAcrossTabs(), []);
  useEffect(() => {
    let queueReady = false;
    let settingsReady = false;
    const boot = () => {
      if (!queueReady || !settingsReady) return;
      void useSettings.getState().syncSessions().catch(() => undefined);
      void useVaultIndex.getState().refresh().catch(() => undefined);
      warmPixivCsrf(useSettings.getState().pixivCookie);
      resumeQueue();
      void warnFolderIfBroken(() => navigate({ to: "/settings", hash: "storage" }));
    };
    const offQueue = onPersisted(useQueue, () => {
      queueReady = true;
      boot();
    });
    const offSettings = onPersisted(useSettings, () => {
      settingsReady = true;
      boot();
    });
    return () => {
      offQueue();
      offSettings();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 启动只跑一次：navigate 来自 useRouter 恒稳定，进依赖会让 boot 在路由翻页时重订阅重跑
  }, []);
  const isBrowse = isBrowsePath(pathname);
  const isDesk = isDeskPath(pathname);
  const overlay = isDetailPath(pathname);
  const [keepBrowse, setKeepBrowse] = useState(isBrowse);
  const browseScroll = useRef(0);
  const wasBrowse = useRef(isBrowse);

  useEffect(() => {
    if (isBrowse) setKeepBrowse(true);
    if (isMainNavPath(pathname)) setKeepBrowse(false);
  }, [isBrowse, pathname]);

  useLayoutEffect(() => {
    if (wasBrowse.current && !isBrowse) browseScroll.current = window.scrollY;
    if (!wasBrowse.current && isBrowse) window.scrollTo(0, browseScroll.current);
    wasBrowse.current = isBrowse;
  }, [isBrowse]);

  const mountBrowse = isBrowse || ((overlay || isDesk) && keepBrowse);
  const paneWidth = expanded ? "md:w-56" : "md:w-16";
  const contentPad = expanded ? "md:pl-56" : "md:pl-16";
  const desktopRawIndex = NAV.findIndex((item) => navItemActive(pathname, item.to));
  const activeIndex = Math.max(0, desktopRawIndex);
  const mobileRawIndex = MOBILE_NAV.findIndex((item) => navItemActive(pathname, item.to));
  const activeIndexMobile = Math.max(0, mobileRawIndex);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="kami-chrome-down sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/80 bg-bg/80 px-3 backdrop-blur-md md:px-4">
        <Hint label={expanded ? "收起导航" : "展开导航"} side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden size-9 md:inline-flex"
            aria-label={expanded ? "收起导航" : "展开导航"}
            onClick={() => setExpanded((v) => !v)}
          >
            <PanelLeft />
          </Button>
        </Hint>
        <Link to="/" className="flex shrink-0 items-center gap-2 px-1">
          <LogoMark className="size-6 text-accent" />
          <span className="hidden font-display text-base tracking-tight sm:inline">Kami 纸匣</span>
        </Link>
        <Separator className="hidden h-5 w-px shrink-0 bg-border sm:block" />
        <SiteSwitcher />
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5">
          <Hint label="追踪" side="bottom">
            <Link
              to="/watch"
              className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:text-fg md:hidden"
              aria-label="追踪"
            >
              <Bell className="size-5" />
              {watchBadge > 0 ? (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-0.5 text-[9px] font-medium tabular-nums text-accent-fg">
                  {watchBadge > 9 ? "9+" : watchBadge}
                </span>
              ) : null}
            </Link>
          </Hint>
          <ThemeMenu />
          <AccountSwitcher />
        </div>
      </header>

      <aside
        className={cn(
          "kami-chrome-left fixed bottom-0 left-0 top-14 z-30 hidden flex-col border-r border-border/80 bg-bg/40 md:flex",
          "transition-[width] duration-200 ease-out",
          paneWidth,
        )}
      >
        <ScrollArea className="min-h-0 flex-1">
        <nav className="relative flex flex-col gap-1 p-2">
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-2 top-2 h-11 rounded-xl bg-elevated transition-transform duration-300 ease-out",
              desktopRawIndex < 0 && "opacity-0",
            )}
            style={{ transform: `translateY(${activeIndex * 3}rem)` }}
          />
          {NAV.map((item) => {
            const active = navItemActive(pathname, item.to);
            const Icon = item.icon;
            const link = (
              <Link
                to={item.to}
                prefetch={item.to === "/browse" ? false : undefined}
                title={expanded ? undefined : item.label}
                data-queue-nav={item.to === "/queue" ? "" : undefined}
                className={cn(
                  "relative z-10 flex h-11 items-center gap-3 overflow-hidden rounded-xl px-3 text-sm transition-colors duration-200",
                  item.to === "/queue" && "kami-queue-nav-desktop",
                  active ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {expanded ? (
                  <>
                    <span className="truncate">{item.label}</span>
                    {item.to === "/queue" && queued > 0 ? (
                      <span className="kami-pop ml-auto tabular-nums text-xs text-accent">{queued}</span>
                    ) : null}
                    {item.to === "/watch" && watchBadge > 0 ? (
                      <span className="kami-pop ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-medium tabular-nums text-accent-fg">
                        {watchBadge > 99 ? "99+" : watchBadge}
                      </span>
                    ) : null}
                  </>
                ) : item.to === "/watch" && watchBadge > 0 ? (
                  <span className="absolute right-2 top-2 size-2 rounded-full bg-accent" />
                ) : null}
              </Link>
            );
            if (expanded) {
              return (
                <div key={item.to} className="contents">
                  {link}
                </div>
              );
            }
            return (
              <Hint key={item.to} label={item.label} side="right">
                {link}
              </Hint>
            );
          })}
        </nav>
        </ScrollArea>
        {expanded ? (
          <p className="mt-auto px-4 pb-4 text-xs leading-relaxed text-subtle">
            个人备份。请尊重作者版权。
          </p>
        ) : null}
      </aside>

      <main className={cn(contentPad, "transition-[padding] duration-300 ease-out")}>
        <PageFrame pathname={pathname} isBrowse={isBrowse} mountBrowse={mountBrowse}>
          {children}
        </PageFrame>
      </main>
      <Onboarding />
      <DropToSearch />

      <nav className="kami-chrome-up fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="relative grid grid-cols-6">
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1 left-0 flex w-1/6 justify-center transition-transform duration-200 ease-out",
              mobileRawIndex < 0 && "opacity-0",
            )}
            style={{ transform: `translateX(${activeIndexMobile * 100}%)` }}
          >
            <span className="h-0.5 w-8 rounded-full bg-accent" />
          </span>
          {MOBILE_NAV.map((item) => {
            const active = navItemActive(pathname, item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                prefetch={item.to === "/browse" ? false : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors duration-200",
                  active ? "text-fg" : "text-muted",
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function PageFrame({
  pathname,
  isBrowse,
  mountBrowse,
  children,
}: {
  pathname: string;
  isBrowse: boolean;
  mountBrowse: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const detail = isDetailPath(pathname);
  useLayoutEffect(() => {
    if (!detail) return;
    const el = ref.current;
    if (!el) return;
    playEnter(el);
  }, [pathname, detail]);
  return (
    <div className="w-full px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-10 md:pb-12">
      {mountBrowse ? (
        <div hidden={!isBrowse} aria-hidden={!isBrowse} className={isBrowse ? "pt-6 md:pt-8" : "hidden"}>
          <BrowsePage />
        </div>
      ) : null}
      {detail && !isWorkPath(pathname) ? <DetailNav /> : null}
      {!isBrowse ? (
        <div ref={ref} className={detail ? "pt-4 md:pt-5" : "pt-6 md:pt-8"}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
