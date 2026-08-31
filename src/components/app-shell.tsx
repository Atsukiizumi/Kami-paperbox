import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AccountSwitcher } from "@/components/account-switcher";
import { SiteSwitcher } from "@/components/site-switcher";
import { Archive, Compass, ListOrdered, PanelLeft, ScanSearch, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueue } from "@/lib/store";
import { ThemeMenu } from "@/components/theme-picker";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";

const NAV = [
  { to: "/", label: "浏览", icon: Compass },
  { to: "/search", label: "搜图", icon: ScanSearch },
  { to: "/queue", label: "队列", icon: ListOrdered },
  { to: "/vault", label: "纸匣", icon: Archive },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("kami-logo size-6 text-accent", className)} aria-hidden>
      <path
        d="M5.5 4.5h9L19 9v11H5.5z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        className="kami-logo-fold"
        d="M14.5 4.5V9H19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isActive(pathname: string, to: (typeof NAV)[number]["to"]) {
  if (to === "/") {
    return (
      pathname === "/" ||
      pathname.startsWith("/work") ||
      pathname.startsWith("/user") ||
      pathname.startsWith("/creator")
    );
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queued = useQueue((s) => s.items.filter((i) => i.status !== "done").length);
  const [expanded, setExpanded] = useState(true);
  const paneWidth = expanded ? "md:w-56" : "md:w-16";
  const contentPad = expanded ? "md:pl-56" : "md:pl-16";
  const activeIndex = Math.max(
    0,
    NAV.findIndex((item) => isActive(pathname, item.to)),
  );

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/80 bg-bg/80 px-3 backdrop-blur-md md:px-4">
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
          <LogoMark />
          <span className="hidden font-display text-base tracking-tight sm:inline">Kami 纸匣</span>
        </Link>
        <Separator className="hidden h-5 w-px shrink-0 bg-border sm:block" />
        <SiteSwitcher />
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5">
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
        <nav className="relative flex flex-col gap-1 p-2">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-2 top-2 h-11 rounded-xl bg-elevated transition-transform duration-200 ease-out"
            style={{ transform: `translateY(${activeIndex * 3}rem)` }}
          />
          {NAV.map((item) => {
            const active = isActive(pathname, item.to);
            const Icon = item.icon;
            const link = (
              <Link
                to={item.to}
                title={expanded ? undefined : item.label}
                className={cn(
                  "relative z-10 flex h-11 items-center gap-3 overflow-hidden rounded-xl px-3 text-sm transition-colors duration-200",
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
                  </>
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
        {expanded ? (
          <p className="mt-auto px-4 pb-4 text-xs leading-relaxed text-subtle">
            个人备份。请尊重作者版权。
          </p>
        ) : null}
      </aside>

      <main className={cn(contentPad, "transition-[padding] duration-200")}>
        <div
          key={pathname}
          className="kami-page mx-auto w-full max-w-7xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 md:px-10 md:pb-12 md:pt-8"
        >
          {children}
        </div>
      </main>

      <nav className="kami-chrome-up fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="relative grid grid-cols-5">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 left-0 flex w-1/5 justify-center transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          >
            <span className="h-0.5 w-8 rounded-full bg-accent" />
          </span>
          {NAV.map((item) => {
            const active = isActive(pathname, item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors duration-200",
                  active ? "text-fg" : "text-muted",
                )}
              >
                <Icon className="size-5" />
                {item.label}
                {item.to === "/queue" && queued > 0 ? (
                  <span className="kami-pop absolute right-3 top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-xs tabular-nums text-accent-fg">
                    {queued}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
