/**
 * 今日案头（主页稿纸）。
 *
 * 作用：打开应用落到这里；去浏览铺当前站封面进 /browse；通栏挂今日报纸；有则挂信、纸叠、画师墙、去年今日笺。
 * 用法：app/page.tsx 渲染 DeskPage。
 * 为什么：浏览是工作面，案头是坐下的那张纸；信不在这里检查追踪。
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { DeskArtistWall } from "@/components/desk/artist-wall";
import { DeskBrowseSheet } from "@/components/desk/browse-sheet";
import { DeskLetters } from "@/components/desk/letters";
import { DeskNewspaper } from "@/components/desk/newspaper";
import { DeskStack } from "@/components/desk/stack";
import { unreadItems } from "@/lib/desk-unread";
import { Link } from "@/lib/kami-link";
import { onThisDay } from "@/lib/storage/vault-profile";
import { listVault, type VaultMeta } from "@/lib/storage/vault";
import { listServerVault } from "@/lib/storage/vault-sync";
import { useSettings, useSettingsHydrated } from "@/lib/store";
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
  const watchArtists = useSettings((s) => s.watchArtists);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const hydrated = useSettingsHydrated();
  const historyItems = useViewHistory((s) => s.items);
  const [vault, setVault] = useState<VaultMeta[]>([]);
  const [vaultReady, setVaultReady] = useState(false);
  const { title, date } = todayLabel();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local: VaultMeta[] = [];
      try {
        local = await listVault();
      } catch {
        local = [];
      }
      let remote: Awaited<ReturnType<typeof listServerVault>> | null = null;
      try {
        remote = await listServerVault();
      } catch {
        remote = null;
      }
      if (cancelled) return;
      const remoteItems = remote?.items ?? [];
      if (remoteItems.length > 0) {
        const map = new Map(remoteItems.map((item) => [item.key, item]));
        for (const item of local) {
          const prev = map.get(item.key);
          map.set(item.key, { ...item, hasFile: prev?.hasFile ?? item.hasFile });
        }
        setVault([...map.values()].sort((a, b) => b.savedAt - a.savedAt));
      } else {
        setVault(local);
      }
      setVaultReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unread = useMemo(
    () => (vaultReady ? unreadItems(vault, historyItems) : []),
    [vaultReady, vault, historyItems],
  );
  const unreadCount = unread.length;
  const slipCount = useMemo(() => {
    if (!vaultReady) return 0;
    return onThisDay(vault, Date.now()).reduce((n, group) => n + group.items.length, 0);
  }, [vaultReady, vault]);

  // 右栏：信/纸叠之外，Pixiv 登录后画师墙也撑得起右栏（墙自带无数据隐身）。
  const pixivLoggedIn = hydrated && pixivCookie.trim() !== "";
  const asideEmpty = watchArtists.length === 0 && unreadCount === 0 && !pixivLoggedIn;

  return (
    <div className="mx-0 max-w-6xl space-y-4 2xl:max-w-[90rem]">
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
        <DeskBrowseSheet className={asideEmpty ? "lg:col-span-3" : "lg:col-span-2"} />
        <DeskNewspaper className={asideEmpty ? "lg:col-span-3" : "lg:col-span-3 lg:col-start-1 lg:row-start-2"} />
        {asideEmpty ? null : (
          <aside className="flex flex-col gap-4 lg:col-start-3 lg:row-start-1">
            <DeskLetters />
            <DeskStack count={unreadCount} items={unread} />
            <DeskArtistWall />
          </aside>
        )}
      </div>
    </div>
  );
}
