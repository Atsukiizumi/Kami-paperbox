/**
 * 案头今日报纸。
 *
 * 作用：现场拉当前站日榜竖图；失败 / 空 / FANBOX 整栏不出现。
 *      日榜有货即水平循环滚动（marquee）：全量日榜（cap 30）复制两份拼成单行
 *      轨道，匀速左移无缝循环（时长 = 张数 × 4s）；悬停、切后台、滚离视口时
 *      animation-play-state 暂停；prefers-reduced-motion 下静止为单行静态列表
 *      （容器可横向滚动）。名次徽标 = 全量下标 + 1。无手动控件。
 * 用法：DeskPage 通栏挂 <DeskNewspaper className={…} />。
 * 为什么：独立 queryKey desk-newspaper，不和保活浏览抢 home-pixiv / home-booru；
 *      整行滚动比整组淡换能上场更多名次，宽度也随视口自适应。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ProxiedImg, warmMedia } from "@/components/proxied-img";
import { useViewportActive } from "@/components/desk/use-viewport-active";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { parseBoardDate } from "@/lib/booru";
import { marqueeDurationMs } from "@/lib/desk-carousel";
import { rankingPageItems } from "@/lib/desk-newspaper";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import { fetchSource } from "@/lib/source";
import { pixivRankingDateParam, rememberRanking } from "@/lib/storage/ranking-archive";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { credentialTag } from "@/lib/sync/cred-tag";
import type { WorkCard } from "@/lib/types";

/** 报纸 marquee：日榜全量上场，cap 30 防性能；单张约 4s 走过（时长见 desk-carousel）。 */
const NEWSPAPER_MARQUEE_CAP = 30;

/** 轨道卡片：等宽收缩，尾随等距外边距（不用 flex gap——gap 会让 -50% 半程错半格缝）。 */
function MarqueeCards({ items, copy }: { items: readonly WorkCard[]; copy: 0 | 1 }) {
  return (
    <>
      {items.map((card, i) => (
        <Link
          key={`${card.source}:${card.id}:${copy}`}
          to="/work/$source/$id"
          params={{ source: card.source, id: card.id }}
          className="relative mr-2 block aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-lg md:w-36"
        >
          <ProxiedImg src={card.thumb} alt="" className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 text-[10px] tabular-nums text-accent-fg">
            {i + 1}
          </span>
        </Link>
      ))}
    </>
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

  // 轨道 = 日榜全量（cap 30）；query.data 引用稳定，track 顺势稳定。
  const trackItems = useMemo(
    () => rankingPageItems(query.data).slice(0, NEWSPAPER_MARQUEE_CAP),
    [query.data],
  );

  useEffect(() => {
    const page = rankingPageItems(query.data);
    if (page.length === 0) return;
    void rememberRanking({ site: tab, period: "daily", date: dateIso, items: page });
  }, [tab, dateIso, query.data]);

  // 滚离视口 / 切后台 → 暂停（CSS data-paused 接管 animation-play-state；悬停暂停在样式层）。
  const { ref: viewportRef, active } = useViewportActive<HTMLElement>();

  // 轨道渲染即整轨预热（warmThumbs 自带去重）——marquee 匀速行进没有「下一帧」概念。
  useEffect(() => {
    for (const card of trackItems) warmMedia(card.thumb);
  }, [trackItems]);

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

  if (query.isError || trackItems.length === 0) return null;

  return (
    <section ref={viewportRef} className={className}>
      <Link to="/rankings" className="text-sm text-muted hover:text-fg">
        今日报纸 · {siteLabel(tab)} 日榜
      </Link>
      <div className="kami-marquee mt-3" data-paused={!active}>
        <div
          className="kami-marquee-track flex w-max"
          style={{ animationDuration: `${marqueeDurationMs(trackItems.length)}ms` }}
        >
          <MarqueeCards items={trackItems} copy={0} />
          <MarqueeCards items={trackItems} copy={1} />
        </div>
      </div>
    </section>
  );
}
