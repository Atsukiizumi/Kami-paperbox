/**
 * 案头去浏览主纸。
 *
 * 作用：当前站默认流封面铺纸面，标题压在下面；整张字区进 /browse，封面进作品。
 *      封面层是系统轮播：默认流前 3 批封面（批随断点：默认 4×2 八张、2xl 起
 *      6×3 十八张，池深恒 = 3 批即 24/54 张）每 8s 整批交叉淡换（双缓冲叠放、
 *      无手动控件）；凑不齐两批（<2×批）时回落到静态网格。
 * 用法：DeskPage 主格挂 <DeskBrowseSheet className={…} />。
 * 为什么：纯字大卡太空；推荐/最新不跟今日报纸的日榜抢同一排。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ProxiedImg } from "@/components/proxied-img";
import { useCrossfade } from "@/components/desk/use-crossfade";
import { useMediaFlag } from "@/components/desk/use-media-flag";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { buildFrames, needsCarousel, sheetBatch } from "@/lib/desk-carousel";
import { previewItems } from "@/lib/desk-preview";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import type { WorkCard } from "@/lib/types";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { fanboxSessionFrom, isPixivLoggedInSession } from "@/lib/sync/browser-login";
import { credentialTag } from "@/lib/sync/cred-tag";
import { cn } from "@/lib/utils";

/** 铺纸轮播节奏：8s 一拍整批换；批随断点（sheetBatch：8/18），池深恒 = 3 批（24/54）。 */
const SHEET_INTERVAL_MS = 8000;

/** 预载口径稳定在模块级，避免每批重挂预载 effect。 */
const sheetFrameUrls = (frame: readonly WorkCard[]) => frame.map((card) => card.thumb);

function SheetGrid({ cards, className }: { cards: readonly WorkCard[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-4 gap-1 p-1.5 2xl:grid-cols-6", className)}>
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

  // 大屏适配：2xl（≥1536px）6 列 ×2 行批 12、池 36；默认 4 列批 8、池 24。
  const is2xl = useMediaFlag("(min-width: 1536px)");
  const batch = sheetBatch(is2xl);
  const poolLimit = batch * 3;

  // query.data 引用稳定（react-query 缓存对象），frames 顺势稳定，节奏不被无关渲染重置。
  // 静态分支与加载骨架同取一批的张数；轮播池对同一份数据多取到 3 批，不新增请求。
  const items = useMemo(() => previewItems(query.data, batch), [query.data, batch]);
  const pending = query.isPending && items.length === 0;

  // 断点翻转会让 frames 重算（身份变化 → 轮播节奏重置一次）：断点切换本就是大事件，可接受。
  const carouselFrames = useMemo(
    () => buildFrames(previewItems(query.data, poolLimit), batch, Math.random, "sequential"),
    [query.data, batch, poolLimit],
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
        <div className="grid grid-cols-4 gap-1 p-1.5 2xl:grid-cols-6">
          {Array.from({ length: batch }, (_, i) => (
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
