"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, usePathname } from "@/lib/kami-link";
import { AccountSwitcher } from "@/components/account-switcher";
import { SiteSwitcher } from "@/components/site-switcher";
import { Archive, Bell, BookOpen, Clock, Compass, EyeOff, ListOrdered, Menu, PanelLeft, ScanSearch, Settings, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { canPickFolder, folderHealth, type FolderHealth } from "@/lib/folder-access";
import { playEnter } from "@/lib/motion";
import { mirrorQueueAcrossTabs, resumeQueue } from "@/lib/queue-runner";
import { useVaultIndex } from "@/lib/storage/vault-index";
import { useWatchBadge } from "@/lib/watch-badge";
import { cn } from "@/lib/utils";
import { onPersisted, useQueue, useSettings } from "@/lib/store";
import { shellRenderPlan } from "@/lib/desk-layout";
import { useEffectiveShell } from "@/lib/theme-pack-client";
import { useVeil } from "@/lib/veil";
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

/** 遮盖开关（顶栏 / 浮胶囊 / zen 面板共用一枚按钮）。 */
function VeilToggle() {
  const veil = useVeil((s) => s.veil);
  return (
    <Hint label={veil ? "关闭遮盖（Esc）" : "遮盖敏感封面"} side="bottom">
      <button
        type="button"
        onClick={() => useVeil.getState().toggle()}
        aria-label="遮盖敏感封面"
        aria-pressed={veil}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-lg transition-colors",
          veil ? "bg-accent/15 text-accent" : "text-muted hover:bg-elevated hover:text-fg",
        )}
      >
        <EyeOff className="size-5" />
      </button>
    </Hint>
  );
}

/** zen 无框形态的浮钮 + 导航纸面板（仅桌面；移动端走原顶栏 / 底部栏）。 */
function ZenDock({
  side,
  pathname,
  queued,
  watchBadge,
}: {
  side: "left" | "right";
  pathname: string;
  queued: number;
  watchBadge: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      {open ? (
        <button aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
      ) : null}
      <div className={cn("kami-zen-dock hidden md:block", side === "left" ? "left-5" : "right-5")}>
        {open ? (
          <div className="kami-zen-panel" style={side === "left" ? { left: 0 } : { right: 0 }}>
            {NAV.map((item) => {
              const active = navItemActive(pathname, item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  prefetch={item.to === "/browse" ? false : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                    active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/70 hover:text-fg",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.to === "/queue" && queued > 0 ? (
                    <span className="ml-auto tabular-nums text-xs text-accent">{queued}</span>
                  ) : null}
                  {item.to === "/watch" && watchBadge > 0 ? (
                    <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-medium tabular-nums text-accent-fg">
                      {watchBadge > 99 ? "99+" : watchBadge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
            <Separator className="my-1.5" />
            <div className="flex items-center gap-0.5 px-1 pb-0.5">
              <SiteSwitcher />
              <VeilToggle />
              <ThemeMenu />
              <AccountSwitcher />
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="kami-zen-trigger"
          aria-label={open ? "收起导航" : "展开导航"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
    </>
  );
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
  const veil = useVeil((s) => s.veil);
  const veilOff = useVeil((s) => s.off);
  const shellEff = useEffectiveShell();
  const theme = useSettings((s) => s.theme);
  const [expanded, setExpanded] = useState(true);

  // 访客遮盖（U）：Esc 一键撤离——演示场景最常用的收尾动作
  useEffect(() => {
    if (!veil) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") veilOff();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [veil, veilOff]);

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
  // 外壳（P1 三形态 + P3 custom 全参数）：结构决策统一来自 shellRenderPlan
  // （守卫：隐藏侧栏⇒浮钮面板、顶栏隐藏/侧栏隐藏⇒胶囊、右置侧栏⇒胶囊翻左），
  // 并吃合并壳层（主题包跟随）。移动端一律原顶栏+底部栏。
  const plan = shellRenderPlan(shellEff);
  const deskForm = !plan.custom && shellEff.form === "desk";
  const paperGrid = theme === "bindery" && deskForm;
  const paperBook = theme === "binding" && deskForm;
  const sideExpanded = plan.sidebarMode === "full" && (deskForm ? paperGrid || paperBook || expanded : true);
  const W_BY_PX = { 48: "md:w-12", 64: "md:w-16", 80: "md:w-20" } as const;
  const PAD_BY_PX = { 48: "md:pl-12", 64: "md:pl-16", 80: "md:pl-20" } as const;
  const paneWidth = plan.custom
    ? ""
    : paperGrid
      ? "md:w-[88px]"
      : deskForm
        ? expanded
          ? "md:w-56"
          : "md:w-16"
        : (plan.sidebarW && W_BY_PX[plan.sidebarW as 48 | 64 | 80]) || "md:w-16";
  const contentPad = plan.custom
    ? "kami-pagepad"
    : shellEff.form === "zen"
      ? ""
      : paperGrid
        ? "md:pl-[88px]"
        : deskForm
          ? expanded
            ? "md:pl-56"
            : "md:pl-16"
          : (plan.sidebarW && PAD_BY_PX[plan.sidebarW as 48 | 64 | 80]) || "md:pl-16";
  const railIconCls = plan.sidebarW === 48 ? "size-3.5" : plan.sidebarW === 80 ? "size-5" : "size-4";
  const desktopRawIndex = NAV.findIndex((item) => navItemActive(pathname, item.to));
  const activeIndex = Math.max(0, desktopRawIndex);
  const mobileRawIndex = MOBILE_NAV.findIndex((item) => navItemActive(pathname, item.to));
  const activeIndexMobile = Math.max(0, mobileRawIndex);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="kami-topbar kami-chrome-down sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/80 bg-bg px-3 md:px-4">
        {deskForm && !paperGrid && !paperBook ? (
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
        ) : null}
        <Link to="/" className="kami-brand flex shrink-0 items-center gap-2 px-1">
          <LogoMark className="size-6 text-accent" />
          <span className="hidden font-display text-base tracking-tight sm:inline">Kami 纸匣</span>
        </Link>
        <Separator className="kami-topbar-rule hidden h-5 w-px shrink-0 bg-border sm:block" />
        <SiteSwitcher />
        {paperBook ? (
          <nav aria-label="房间" className="kami-running hidden min-w-0 flex-1 items-baseline gap-x-4 overflow-x-auto md:flex">
            {NAV.map((item) => {
              const active = navItemActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  prefetch={item.to === "/browse" ? false : undefined}
                  className={cn(
                    "shrink-0 text-[13px] tracking-[0.14em]",
                    active ? "text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {item.label}
                  {item.to === "/queue" && queued > 0 ? (
                    <span className="ml-1 font-display tabular-nums text-danger">{queued}</span>
                  ) : null}
                  {item.to === "/watch" && watchBadge > 0 ? (
                    <span className="ml-1 font-display tabular-nums text-danger">
                      {watchBadge > 99 ? "99+" : watchBadge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        ) : null}
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
          <VeilToggle />
          <ThemeMenu />
          <AccountSwitcher />
        </div>
      </header>

      {plan.sidebarMode === "hidden" ? null : (
      <aside
        className={cn(
          "kami-aside fixed bottom-0 left-0 top-14 z-30 hidden flex-col bg-bg/40 md:flex",
          "transition-[width] duration-200 ease-out",
          // 预设形态带右边框（custom 的边框随左右位置由 CSS 给）
          !plan.custom && "border-r border-border/80",
          paneWidth,
        )}
      >
        <ScrollArea className="kami-spine-scroll min-h-0 flex-1">
        <nav className="relative flex flex-col gap-1 p-2">
          <span
            aria-hidden
            className={cn(
              "kami-nav-marker pointer-events-none absolute inset-x-2 top-2 h-11 rounded-xl bg-elevated",
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
                title={sideExpanded ? undefined : item.label}
                data-queue-nav={item.to === "/queue" ? "" : undefined}
                className={cn(
                  "relative z-10 flex h-11 items-center gap-3 overflow-hidden rounded-xl px-3 text-sm transition-colors duration-200",
                  item.to === "/queue" && "kami-queue-nav-desktop",
                  active ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                <Icon className={cn("shrink-0", railIconCls)} />
                {sideExpanded ? (
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
            if (sideExpanded) {
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
        {sideExpanded ? (
          <p className="mt-auto px-4 pb-4 text-xs leading-relaxed text-subtle">
            个人备份。请尊重作者版权。
          </p>
        ) : null}
      </aside>
      )}

      <main className={cn(contentPad, "transition-[padding] duration-300 ease-out")}>
        <PageFrame pathname={pathname} isBrowse={isBrowse} mountBrowse={mountBrowse}>
          {children}
        </PageFrame>
      </main>
      {plan.capsule !== "none" ? (
        <div className={cn("kami-float-controls hidden md:flex", plan.capsule === "left" && "kami-float-left")}>
          <SiteSwitcher />
          <VeilToggle />
          <ThemeMenu />
          <AccountSwitcher />
        </div>
      ) : null}
      {plan.dock ? (
        <ZenDock side={plan.dockSide} pathname={pathname} queued={queued} watchBadge={watchBadge} />
      ) : null}
      <Onboarding />
      <DropToSearch />

      <nav className="kami-chrome-up fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="relative grid grid-cols-6">
          <span
            aria-hidden
            className={cn(
              "kami-nav-marker pointer-events-none absolute top-1 left-0 flex w-1/6 justify-center",
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
    <div className="kami-pageframe w-full px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-10 md:pb-12">
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
