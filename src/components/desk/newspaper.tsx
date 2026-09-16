/**
 * 案头今日报纸。
 *
 * 作用：现场拉当前站日榜竖图；失败 / 空 / FANBOX 整栏不出现。
 *      日榜 ≥8 名时四格是系统轮播：前 12 名按 4 张分 3 组，每 12s 整组交叉淡换
 *      （四格一起换，不是逐格轮）；不足两帧回落到现状的静态四格。
 * 用法：DeskPage 通栏挂 <DeskNewspaper className={…} />。
 * 为什么：独立 queryKey desk-newspaper，不和保活浏览抢 home-pixiv / home-booru。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ProxiedImg } from "@/components/proxied-img";
import { useCrossfade } from "@/components/desk/use-crossfade";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { parseBoardDate } from "@/lib/booru";
import { buildFrames, needsCarousel } from "@/lib/desk-carousel";
import { newspaperItems, rankingPageItems } from "@/lib/desk-newspaper";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import type { WorkCard } from "@/lib/types";
import { fetchSource } from "@/lib/source";
import { pixivRankingDateParam, rememberRanking } from "@/lib/storage/ranking-archive";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { credentialTag } from "@/lib/sync/cred-tag";
import { cn } from "@/lib/utils";

/** 报纸轮播节奏：池 = 日榜前 12 名，4 张一组，12s 整组换。 */
const NEWSPAPER_INTERVAL_MS = 12000;
const NEWSPAPER_POOL_LIMIT = 12;
const NEWSPAPER_GROUP_SIZE = 4;

/** 预载口径稳定在模块级，避免每组重挂预载 effect。 */
const newspaperFrameUrls = (group: readonly WorkCard[]) => group.map((card) => card.thumb);

function NewspaperRow({
  group,
  rankBase,
  className,
}: {
  group: readonly WorkCard[];
  rankBase: number;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      {group.map((card, i) => (
        <Link
          key={`${card.source}:${card.id}`}
          to="/work/$source/$id"
          params={{ source: card.source, id: card.id }}
          className="relative block aspect-[3/4] min-w-[28%] flex-1 overflow-hidden rounded-lg md:min-w-0"
        >
          <ProxiedImg src={card.thumb} alt="" className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 text-[10px] tabular-nums text-accent-fg">
            {rankBase + i + 1}
          </span>
        </Link>
      ))}
    </div>
  );
}

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

  // 池 = 日榜前 12 名分 3 组；query.data 引用稳定，frames 顺势稳定。
  const carouselFrames = useMemo(
    () =>
      buildFrames(
        rankingPageItems(query.data).slice(0, NEWSPAPER_POOL_LIMIT),
        NEWSPAPER_GROUP_SIZE,
        Math.random,
        "sequential",
      ),
    [query.data],
  );
  const { frame, frameIndex, containerRef } = useCrossfade({
    frames: carouselFrames,
    intervalMs: NEWSPAPER_INTERVAL_MS,
    urlsOf: newspaperFrameUrls,
  });
  // 双缓冲整组换：奇偶各占一层，每层带自己的名次起点，四格一起淡。
  const groupCount = carouselFrames.length;
  const prevIndex = groupCount === 0 ? 0 : (frameIndex - 1 + groupCount) % groupCount;
  const groupOn = (parity: 0 | 1) => {
    const index = frameIndex % 2 === parity ? frameIndex : prevIndex;
    return { group: carouselFrames[index] ?? [], rankBase: index * NEWSPAPER_GROUP_SIZE };
  };
  const layerClass = (visible: boolean) =>
    cn(
      "transition-opacity duration-[600ms] motion-reduce:transition-none",
      visible ? "opacity-100" : "pointer-events-none opacity-0",
    );

  if (tab === "fanbox") return null;

  if (query.isPending) {
    return (
      <section className={className}>
        <p className="text-sm text-muted">今日报纸</p>
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[3/4] min-w-[28%] flex-1 rounded-lg bg-surface md:min-w-0" />
          ))}
        </div>
      </section>
    );
  }

  if (query.isError || items.length === 0) return null;

  return (
    <section ref={containerRef} className={className}>
      <Link to="/rankings" className="text-sm text-muted hover:text-fg">
        今日报纸 · {siteLabel(tab)} 日榜
      </Link>
      {needsCarousel(carouselFrames) && frame ? (
        <div className="mt-3 overflow-x-auto">
          <div className="relative">
            <NewspaperRow group={groupOn(0).group} rankBase={groupOn(0).rankBase} className={layerClass(frameIndex % 2 === 0)} />
            <NewspaperRow
              group={groupOn(1).group}
              rankBase={groupOn(1).rankBase}
              className={cn("absolute inset-x-0 inset-y-0", layerClass(frameIndex % 2 === 1))}
            />
          </div>
        </div>
      ) : (
        <NewspaperRow group={items} rankBase={0} className="mt-3 overflow-x-auto" />
      )}
    </section>
  );
}
