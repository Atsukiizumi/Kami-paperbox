/**
 * 案头今日报纸。
 *
 * 作用：现场拉当前站日榜前 4 张竖图；失败 / 空 / FANBOX 整栏不出现。
 * 用法：DeskPage 通栏挂 <DeskNewspaper className={…} />。
 * 为什么：独立 queryKey desk-newspaper，不和保活浏览抢 home-pixiv / home-booru。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ProxiedImg } from "@/components/proxied-img";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { parseBoardDate } from "@/lib/booru";
import { newspaperItems, rankingPageItems } from "@/lib/desk-newspaper";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import { fetchSource } from "@/lib/source";
import { pixivRankingDateParam, rememberRanking } from "@/lib/storage/ranking-archive";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { credentialTag } from "@/lib/sync/cred-tag";

export function DeskNewspaper({ className }: { className?: string }) {
  const tab = useSettings((s) => s.tab);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const cookie = useSettings((s) => s.pixivCookie);
  const hydrated = useSettingsHydrated();
  const dateIso = parseBoardDate().iso;

  const query = useQuery({
    queryKey: ["desk-newspaper", tab, safeMode, hideAi, credentialTag(cookie), dateIso],
    enabled: hydrated && tab !== "fanbox",
    staleTime: BROWSE_STALE_MS,
    queryFn: async () => {
      const creds = cookiesFromSettings();
      if (tab === "pixiv") {
        return fetchSource({
          data: {
            op: "pixivRanking",
            mode: "daily",
            page: 1,
            date: pixivRankingDateParam(dateIso),
            ...creds,
          },
        });
      }
      if (isBooru(tab)) {
        return fetchSource({
          data: {
            op: "booruList",
            site: tab,
            feed: "daily",
            page: 1,
            date: dateIso,
            ...creds,
          },
        });
      }
      throw new Error("不应发生");
    },
  });

  const items = newspaperItems(query.data);

  useEffect(() => {
    const page = rankingPageItems(query.data);
    if (page.length === 0) return;
    void rememberRanking({ site: tab, period: "daily", date: dateIso, items: page });
  }, [tab, dateIso, query.data]);

  if (tab === "fanbox") return null;

  if (query.isPending) {
    return (
      <section className={className}>
        <p className="text-sm text-muted">今日报纸</p>
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[3/4] w-[4.5rem] shrink-0 rounded-lg bg-surface md:w-24" />
          ))}
        </div>
      </section>
    );
  }

  if (query.isError || items.length === 0) return null;

  return (
    <section className={className}>
      <Link to="/rankings" className="text-sm text-muted hover:text-fg">
        今日报纸 · {siteLabel(tab)} 日榜
      </Link>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {items.map((card, index) => (
          <Link
            key={`${card.source}:${card.id}`}
            to="/work/$source/$id"
            params={{ source: card.source, id: card.id }}
            className="relative block w-[4.5rem] shrink-0 overflow-hidden rounded-lg md:w-24"
          >
            <ProxiedImg src={card.thumb} alt="" className="aspect-[3/4] w-full object-cover" />
            <span className="absolute left-1 top-1 text-[10px] tabular-nums text-accent-fg">{index + 1}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
