"use client";

/**
 * 卡片网格（瀑布流容器 + 骨架）。
 *
 * 作用：ArtworkGrid 把作品数组铺进 MasonryBoard（空数组给 EmptySheet，顺带把
 *      见到的 tag 喂给词表仓库）；ArtworkGridSkeleton 是同构骨架。
 * 用法：浏览 / 相关 / 历史 / 榜单等列表页；从 artwork-card 再导出保持原入口。
 * 为什么：骨架必须与真卡片共用 MasonryBoard，否则真图进来会跳（排版铁律）。
 */
import { useEffect, type CSSProperties } from "react";
import type { WorkCard } from "@/lib/types";
import { useTagCatalog } from "@/lib/tag-catalog";
import { MasonryBoard } from "./masonry-board";
import { EmptySheet } from "./empty-sheet";
import { ArtworkCard } from "./artwork-card";

const SKELETON_ASPECT = 3 / 4;

export function ArtworkGrid({
  items,
  empty,
  marksOf,
  selection,
}: {
  items: WorkCard[];
  empty?: string;
  marksOf?: (work: WorkCard) => string[] | undefined;
  /** 批量收藏（D）：传入即进入勾选形态，key 为 `${source}:${id}`。 */
  selection?: { selected: Set<string>; onToggle: (key: string) => void };
}) {
  useEffect(() => {
    useTagCatalog.getState().ingestMany(items);
  }, [items]);
  if (items.length === 0) {
    return <EmptySheet title={empty ?? "没有符合条件的作品。"} hint="换个站点或标签再看。" />;
  }
  const boardKey = `${items[0]?.source ?? "x"}:${items[0]?.id ?? "empty"}`;
  return (
    <MasonryBoard key={boardKey}>
      {items.map((work, i) => (
        <ArtworkCard
          key={`${work.source}-${work.id}`}
          work={work}
          index={i}
          marks={marksOf?.(work)}
          selection={
            selection
              ? {
                  checked: selection.selected.has(`${work.source}:${work.id}`),
                  onToggle: () => selection.onToggle(`${work.source}:${work.id}`),
                }
              : undefined
          }
        />
      ))}
    </MasonryBoard>
  );
}

export function ArtworkGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <MasonryBoard>
      {Array.from({ length: count }).map((_, i) => (
        <article
          key={i}
          className="kami-enter"
          data-aspect={String(SKELETON_ASPECT)}
          style={
            {
              animationDelay: `${Math.min(i, 12) * 40}ms`,
              ["--card-aspect"]: String(SKELETON_ASPECT),
            } as CSSProperties
          }
        >
          <div className="kami-card-shell overflow-hidden">
            <div
              className="kami-card-media kami-shimmer"
              style={{ ["--shimmer-delay" as string]: `${(i % 6) * 0.12}s` }}
            />
            <div className="kami-card-caption flex h-[5.5rem] flex-col justify-center gap-2 px-3">
              <span className="kami-shimmer h-3 w-4/5 rounded-md" />
              <span className="kami-shimmer h-2.5 w-2/5 rounded-md" />
            </div>
          </div>
        </article>
      ))}
    </MasonryBoard>
  );
}
