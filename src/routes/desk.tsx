/**
 * 今日案头（主页稿纸）。
 *
 * 作用：打开应用落到这里；去浏览进 /browse；通栏挂今日报纸；有则挂信、纸叠、去年今日笺。
 * 用法：app/page.tsx 渲染 DeskPage。
 * 为什么：浏览是工作面，案头是坐下的那张纸；信不在这里检查追踪。
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { DeskLetters } from "@/components/desk/letters";
import { DeskNewspaper } from "@/components/desk/newspaper";
import { DeskStack } from "@/components/desk/stack";
import { unreadItems } from "@/lib/desk-unread";
import { Link } from "@/lib/kami-link";
import { siteLabel } from "@/lib/sites";
import { onThisDay } from "@/lib/storage/vault-profile";
import { listVault, type VaultMeta } from "@/lib/storage/vault";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useViewHistory } from "@/lib/view-history";

function todayLabel(now = new Date()): { title: string; date: string } {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  return { title: "今日", date };
}

export function DeskPage() {
  const tab = useSettings((s) => s.tab);
  const watchArtists = useSettings((s) => s.watchArtists);
  const historyItems = useViewHistory((s) => s.items);
  const [vault, setVault] = useState<VaultMeta[]>([]);
  const [vaultReady, setVaultReady] = useState(false);
  const { title, date } = todayLabel();

  useEffect(() => {
    let cancelled = false;
    void listVault()
      .then((rows) => {
        if (!cancelled) setVault(rows);
      })
      .catch(() => {
        if (!cancelled) setVault([]);
      })
      .finally(() => {
        if (!cancelled) setVaultReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unreadCount = useMemo(
    () => (vaultReady ? unreadItems(vault, historyItems).length : 0),
    [vaultReady, vault, historyItems],
  );
  const slipCount = useMemo(() => {
    if (!vaultReady) return 0;
    return onThisDay(vault, Date.now()).reduce((n, group) => n + group.items.length, 0);
  }, [vaultReady, vault]);

  const asideEmpty = watchArtists.length === 0 && unreadCount === 0;

  return (
    <div className="mx-0 max-w-6xl space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-3">
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">{title}</h1>
        <p className="text-sm text-muted">{date}</p>
        {slipCount > 0 ? (
          <Link to="/vault?recall=1" className="kami-slip ml-auto">
            去年的今天，你收了 {slipCount} 张
          </Link>
        ) : null}
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Link
          to="/browse"
          prefetch={false}
          className={cn(
            "kami-card-folded relative block rounded-xl bg-surface p-6 shadow-[var(--shadow-paper-1)] md:min-h-[17.5rem] md:p-8",
            asideEmpty ? "lg:col-span-3" : "lg:col-span-2",
          )}
        >
          <p className="text-xs tracking-wide text-subtle">当前 · {siteLabel(tab)}</p>
          <p className="mt-6 font-display text-[2rem] tracking-tight md:text-5xl">去浏览</p>
          <p className="mt-3 text-sm text-muted">日榜、关注、推荐都在那边</p>
        </Link>
        <DeskNewspaper className={asideEmpty ? "lg:col-span-3" : "lg:col-span-3 lg:col-start-1 lg:row-start-2"} />
        {asideEmpty ? null : (
          <aside className="flex flex-col gap-4 lg:col-start-3 lg:row-start-1">
            <DeskLetters />
            <DeskStack count={unreadCount} />
          </aside>
        )}
      </div>
    </div>
  );
}
