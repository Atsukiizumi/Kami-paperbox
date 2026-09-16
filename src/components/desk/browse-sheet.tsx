/**
 * 案头去浏览主纸。
 *
 * 作用：当前站默认流封面铺纸面，标题压在下面；整张字区进 /browse，封面进作品。
 *      封面层是系统轮播：默认流前 24 张封面按 8 张分 3 批，每 8s 整批交叉淡换
 *      （4×2 八格版式不变、双缓冲叠放、无手动控件）；凑不齐两批（<16 张）时
 *      回落到现状的静态八格。
 * 用法：DeskPage 主格挂 <DeskBrowseSheet className={…} />。
 * 为什么：纯字大卡太空；推荐/最新不跟今日报纸的日榜抢同一排。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ProxiedImg } from "@/components/proxied-img";
import { useCrossfade } from "@/components/desk/use-crossfade";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { buildFrames, needsCarousel } from "@/lib/desk-carousel";
import { DESK_PREVIEW_LIMIT, previewItems } from "@/lib/desk-preview";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import type { WorkCard } from "@/lib/types";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { fanboxSessionFrom, isPixivLoggedInSession } from "@/lib/sync/browser-login";
import { credentialTag } from "@/lib/sync/cred-tag";
import { cn } from "@/lib/utils";

/** 铺纸轮播节奏：展示 8 格 ×3 备池 = 前 24 张，8 张一批整批换，8s 一拍。 */
const SHEET_INTERVAL_MS = 8000;
const SHEET_POOL_LIMIT = 24;
const SHEET_BATCH_SIZE = 8;

/** 预载口径稳定在模块级，避免每批重挂预载 effect。 */
const sheetFrameUrls = (frame: readonly WorkCard[]) => frame.map((card) => card.thumb);

function SheetGrid({ cards, className }: { cards: readonly WorkCard[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-4 gap-1 p-1.5", className)}>
      {cards.map((card) => (
        <Link
          key={`${card.source}:${card.id}`}
          to="/work/$source/$id"
          params={{ source: card.source, id: card.id }}
          className="relative block aspect-[3/4] overflow-hidden rounded-md bg-elevated"
        >
          <ProxiedImg src={card.thumb} alt="" className="h-full w-full object-cover" />
        </Link>
      ))}
    </div>
  );
}

export function DeskBrowseSheet({ className }: { className?: string }) {
  const tab = useSettings((s) => s.tab);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const hydrated = useSettingsHydrated();
  const pixivLoggedIn =
    isPixivLoggedInSession(pixivCookie) ||
    Boolean(accounts.find((a) => a.id === activeAccountId)?.pixivProfile?.id);
  const pixivOp = pixivLoggedIn ? "recommend" : "ranking";

  const query = useQuery({
    queryKey: [
      "desk-preview",
      tab,
      pixivOp,
      Boolean(fanboxCookie),
      safeMode,
      hideAi,
      credentialTag(tab === "fanbox" ? fanboxCookie : pixivCookie),
    ],
    enabled: hydrated,
    staleTime: BROWSE_STALE_MS,
    queryFn: async () => {
      const creds = cookiesFromSettings();
      if (tab === "pixiv") {
        if (pixivLoggedIn) return fetchSource({ data: { op: "pixivRecommend", ...creds } });
        return fetchSource({ data: { op: "pixivRanking", mode: "daily", page: 1, ...creds } });
      }
      if (tab === "fanbox") {
        if (fanboxCookie) return fetchSource({ data: { op: "fanboxHome", ...creds } });
        return fetchSource({ data: { op: "fanboxCreator", id: "official", ...creds } });
      }
      if (isBooru(tab)) {
        return fetchSource({ data: { op: "booruList", site: tab, feed: "recent", page: 1, ...creds } });
      }
      throw new Error("不应发生");
    },
  });

  // query.data 引用稳定（react-query 缓存对象），frames 顺势稳定，节奏不被无关渲染重置。
  // 静态分支仍取 8 张；轮播池对同一份数据多取到 24，不新增请求。
  const items = useMemo(() => previewItems(query.data), [query.data]);
  const pending = query.isPending && items.length === 0;

  const carouselFrames = useMemo(
    () => buildFrames(previewItems(query.data, SHEET_POOL_LIMIT), SHEET_BATCH_SIZE, Math.random, "sequential"),
    [query.data],
  );
  const { frame, previousFrame, frameIndex, containerRef } = useCrossfade({
    frames: carouselFrames,
    intervalMs: SHEET_INTERVAL_MS,
    urlsOf: sheetFrameUrls,
  });
  // 双缓冲整批换：奇偶各占一层，当前层不透明、另一层淡出收走点击。
  const layerCards = (parity: 0 | 1): readonly WorkCard[] =>
    (frameIndex % 2 === parity ? frame : previousFrame) ?? [];
  const layerClass = (visible: boolean) =>
    cn(
      "transition-opacity duration-[600ms] motion-reduce:transition-none",
      visible ? "opacity-100" : "pointer-events-none opacity-0",
    );

  return (
    <section
      ref={containerRef}
      className={cn(
        "kami-card-folded relative overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-paper-1)]",
        className,
      )}
    >
      {pending ? (
        <div className="grid grid-cols-4 gap-1 p-1.5">
          {Array.from({ length: DESK_PREVIEW_LIMIT }, (_, i) => (
            <div key={i} className="aspect-[3/4] rounded-md bg-elevated" />
          ))}
        </div>
      ) : needsCarousel(carouselFrames) && frame ? (
        <div className="relative">
          <SheetGrid cards={layerCards(0)} className={layerClass(frameIndex % 2 === 0)} />
          <SheetGrid
            cards={layerCards(1)}
            className={cn("absolute inset-0", layerClass(frameIndex % 2 === 1))}
          />
        </div>
      ) : (
        <SheetGrid cards={items} />
      )}
      <div className="flex items-end justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-xs tracking-wide text-subtle">当前 · {siteLabel(tab)}</p>
          <Link
            to="/browse"
            prefetch={false}
            className="mt-1 block font-display text-3xl tracking-tight md:text-4xl"
          >
            去浏览
          </Link>
          <p className="mt-1 text-sm text-muted">日榜、关注、推荐都在那边</p>
        </div>
      </div>
    </section>
  );
}
