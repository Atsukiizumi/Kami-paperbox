/**
 * 案头画师墙。
 *
 * 作用：有追踪画师时，右栏用 Pixiv 关注流头像砌一面 3 列方格墙——洗牌成批
 *      （动态 9–12 张）、每 8s 整墙交叉淡换；点格子进画师页。
 * 用法：DeskPage 右栏 DeskStack 之下挂 <DeskArtistWall />；无追踪 / 流空 /
 *      没有头像时整块不出现，不留空位。
 * 为什么：右栏只有信和纸叠时下方留白；关注的画师正好补一面会呼吸的墙。
 * 数据：fetchSource pixivMyFollowing page=1（watch 页同款 op），仅 watchArtists>0 时拉，
 *      staleTime 与去浏览同档（BROWSE_STALE_MS）。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ProxiedImg } from "@/components/proxied-img";
import { useCrossfade } from "@/components/desk/use-crossfade";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { artistWallSize, buildFrames, needsCarousel } from "@/lib/desk-carousel";
import { Link } from "@/lib/kami-link";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { credentialTag } from "@/lib/sync/cred-tag";
import { cn } from "@/lib/utils";

/** 画师墙节奏：池上限 36，8s 整墙换一批。 */
const WALL_INTERVAL_MS = 8000;
const WALL_POOL_CAP = 36;

type WallArtist = { id: string; name: string; avatar: string };

/** 预载口径稳定在模块级，避免每批重挂预载 effect。 */
const wallFrameUrls = (batch: readonly WallArtist[]) => batch.map((artist) => artist.avatar);

function WallGrid({ batch, className }: { batch: readonly WallArtist[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)}>
      {batch.map((artist) => (
        <Link
          key={artist.id}
          to={`/user/${artist.id}`}
          className="relative block aspect-square overflow-hidden rounded-md bg-elevated"
        >
          <ProxiedImg src={artist.avatar} alt={artist.name} className="h-full w-full object-cover" />
        </Link>
      ))}
    </div>
  );
}

export function DeskArtistWall() {
  const watchArtists = useSettings((s) => s.watchArtists);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const hydrated = useSettingsHydrated();

  const query = useQuery({
    queryKey: ["desk-artist-wall", credentialTag(pixivCookie)],
    enabled: hydrated && watchArtists.length > 0,
    staleTime: BROWSE_STALE_MS,
    queryFn: () =>
      fetchSource({ data: { op: "pixivMyFollowing", page: 1, ...cookiesFromSettings() } }),
  });

  // 池 = 关注流里有头像的画师，上限 36；query.data 引用稳定，frames 顺势稳定。
  const pool = useMemo<WallArtist[]>(() => {
    if (query.data?.op !== "pixivMyFollowing") return [];
    return query.data.items.filter((artist) => Boolean(artist.avatar)).slice(0, WALL_POOL_CAP);
  }, [query.data]);

  const frames = useMemo(
    () => buildFrames(pool, artistWallSize(pool.length), Math.random, "shuffle"),
    [pool],
  );
  const { frame, previousFrame, frameIndex, containerRef } = useCrossfade({
    frames,
    intervalMs: WALL_INTERVAL_MS,
    urlsOf: wallFrameUrls,
  });
  // 双缓冲整墙换：奇偶各占一层，当前层不透明、另一层淡出收走点击。
  const layerBatch = (parity: 0 | 1): readonly WallArtist[] =>
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
    </section>
  );
}
