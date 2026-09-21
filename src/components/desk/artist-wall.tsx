/**
 * 案头画师墙。
 *
 * 作用：Pixiv 登录时，右栏用关注画师的**最新作品缩略图**砌一面固定 3×3 方格墙
 *      ——格数恒 9、缩略图随卡片宽度伸缩（grid 1fr 自适应），洗牌成批每 8s
 *      整墙交叉淡换；点格子进作品页。3–8 张不硬凑，静态展示现有几张；少于
 *      3 张砌不成墙，整块隐身。
 * 用法：DeskPage 右栏 DeskStack 之下挂 <DeskArtistWall />；未登录 / 流空 /
 *      不足 3 张时整块不出现，不留空位。
 * 为什么：右栏只有信和纸叠时下方留白；关注画师最新更新的图正好补一面会呼吸的墙。
 * 数据：fetchSource pixivFollowing page=1（关注新作品流，WorkCard[] 带缩略图），
 *      仅 Pixiv 登录时拉（与本地追踪名单无关），staleTime 与去浏览同档（BROWSE_STALE_MS）。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ProxiedImg } from "@/components/proxied-img";
import { useCrossfade } from "@/components/desk/use-crossfade";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { buildFrames, needsCarousel } from "@/lib/desk-carousel";
import { Link } from "@/lib/kami-link";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { isPixivLoggedInSession } from "@/lib/sync/browser-login";
import { credentialTag } from "@/lib/sync/cred-tag";
import type { WorkCard } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 画师墙节奏：池上限 36，8s 整墙换一批。 */
const WALL_INTERVAL_MS = 8000;
const WALL_POOL_CAP = 36;

/** 预载口径稳定在模块级，避免每批重挂预载 effect。 */
const wallFrameUrls = (batch: readonly WorkCard[]) => batch.map((card) => card.thumb);

function WallGrid({ batch, className }: { batch: readonly WorkCard[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)}>
      {batch.map((card) => (
        <Link
          key={`${card.source}:${card.id}`}
          to="/work/$source/$id"
          params={{ source: card.source, id: card.id }}
          title={card.title}
          className="relative block aspect-square overflow-hidden rounded-md bg-elevated"
        >
          <ProxiedImg src={card.thumb} alt={card.title} className="h-full w-full object-cover" />
        </Link>
      ))}
    </div>
  );
}

export function DeskArtistWall() {
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const hydrated = useSettingsHydrated();
  const pixivLoggedIn =
    isPixivLoggedInSession(pixivCookie) ||
    Boolean(accounts.find((a) => a.id === activeAccountId)?.pixivProfile?.id);

  const query = useQuery({
    queryKey: ["desk-artist-wall", credentialTag(pixivCookie)],
    // 关注新作品流只取决于 Pixiv 登录，与本地追踪名单无关——追踪名单为空也要出墙。
    enabled: hydrated && pixivLoggedIn,
    staleTime: BROWSE_STALE_MS,
    queryFn: () =>
      fetchSource({ data: { op: "pixivFollowing", page: 1, ...cookiesFromSettings("pixiv") } }),
  });

  // 池 = 关注新作品流里有缩略图的图，上限 36；query.data 引用稳定，frames 顺势稳定。
  // 登出在数据加工层再拦一道——enabled:false 不阻止读旧缓存。
  const pool = useMemo<WorkCard[]>(() => {
    if (!pixivLoggedIn || query.data?.op !== "pixivFollowing") return [];
    return query.data.items.filter((card) => Boolean(card.thumb)).slice(0, WALL_POOL_CAP);
  }, [query.data, pixivLoggedIn]);

  const frames = useMemo(() => {
    // 固定 3×3：格数恒 9，缩略图随卡片宽度伸缩（grid 1fr 自适应）；
    // 3–8 张不硬凑，静态展示现有几张；少于 3 张砌不成墙。
    if (pool.length < 3) return [];
    return buildFrames(pool, pool.length >= 9 ? 9 : pool.length, Math.random, "shuffle");
  }, [pool]);

  const { frame, previousFrame, frameIndex, containerRef } = useCrossfade({
    frames,
    intervalMs: WALL_INTERVAL_MS,
    urlsOf: wallFrameUrls,
  });
  // 双缓冲整墙换：奇偶各占一层，当前层不透明、另一层淡出收走点击。
  const layerBatch = (parity: 0 | 1): readonly WorkCard[] =>
    (frameIndex % 2 === parity ? frame : previousFrame) ?? [];
  const layerClass = (visible: boolean) =>
    cn(
      "transition-opacity duration-[600ms] motion-reduce:transition-none",
      visible ? "opacity-100" : "pointer-events-none opacity-0",
    );

  if (frames.length === 0) return null;

  return (
    <section
      ref={containerRef}
      aria-label="关注画师墙"
      className="rounded-xl bg-surface p-3 shadow-[var(--shadow-paper-1)]"
    >
      {needsCarousel(frames) && frame ? (
        <div className="relative">
          <WallGrid batch={layerBatch(0)} className={layerClass(frameIndex % 2 === 0)} />
          <WallGrid
            batch={layerBatch(1)}
            className={cn("absolute inset-0", layerClass(frameIndex % 2 === 1))}
          />
        </div>
      ) : (
        <WallGrid batch={frames[0] ?? []} />
      )}
      <p className="mt-2 text-sm text-muted">画师墙 · 关注的最新更新</p>
    </section>
  );
}
