"use client";

/**
 * 浏览卡片。
 *
 * 作用：封面 + 两行标题 + 作者/分辨率/标签；封面上可保存、入队，Pixiv 可点红心。
 * 用法：列表页从本文件引 ArtworkCard / ArtworkGrid / ArtworkGridSkeleton（后两者
 *      实现在 artwork-grid.tsx，这里再导出保持原入口）。交互接线在
 *      use-card-interactions.ts，操作托与题注各自成组件。
 * 为什么：标题至少两行、卡片有最小宽度，避免竖图被挤成「私…」。
 *        保存/入队/红心叠在封面上，不占标题宽度。
 */
import { useRef, type CSSProperties, type MouseEvent } from "react";
import { Link } from "@/lib/kami-link";
import { Check, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { CardMenu } from "@/components/card-menu";
import { HoverPreview } from "@/components/hover-preview";
import { cardAspect, cardLayout } from "@/lib/card-aspect";
import type { WorkCard } from "@/lib/types";
import { isBooru } from "@/lib/sites";
import { isNsfwRating } from "@/lib/booru";
import { isAiWork } from "@/lib/pixiv-feed";
import { workKey } from "@/lib/storage/vault";
import { useVaultIndex } from "@/lib/storage/vault-index";
import { useQueue } from "@/lib/store";
import { cn, formatResolution } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { ProxiedImg } from "./proxied-img";
import { UgoiraCover } from "@/components/ugoira-player";
import { pageThumbUrls } from "@/lib/page-thumbs";
import { useCardInteractions } from "./use-card-interactions";
import { CardActionTray } from "./card-action-tray";
import { CardCaption } from "./card-caption";

export { ArtworkGrid, ArtworkGridSkeleton } from "./artwork-grid";

export function ArtworkCard({
  work,
  index = 0,
  variant = "browse",
  marks,
  onExport,
  onDelete,
  selection,
}: {
  work: WorkCard;
  index?: number;
  variant?: "browse" | "vault";
  marks?: string[];
  onExport?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
  /** 批量收藏（D）：勾选 chip（壳左上角）；不传不渲染。 */
  selection?: { checked: boolean; onToggle: () => void };
}) {
  const hasMedia = Boolean(work.thumb);
  const pages = pageThumbUrls(work.thumb, work.pageCount);
  const aspect = hasMedia ? cardAspect(work.width, work.height) : variant === "vault" ? 3 / 4 : 5 / 3;
  const layout = hasMedia ? cardLayout(work.width, work.height) : "wide";
  const inVault = useVaultIndex((s) => Boolean(s.keys[workKey(work.source, work.id)]));
  const inQueue = useQueue((s) =>
    s.items.some(
      (x) => x.key === workKey(work.source, work.id) && (x.status === "queued" || x.status === "running"),
    ),
  );
  const resolution = formatResolution(work.width, work.height);
  const mediaRef = useRef<HTMLDivElement>(null);
  const ugoira = work.source === "pixiv" && work.illustType === 2;
  const {
    cover,
    liked,
    pageI,
    setPageI,
    preview,
    menu,
    setMenu,
    liking,
    heartPop,
    armPrefetch,
    cancelPrefetch,
    showPreview,
    hidePreview,
    saveCard,
    queueCard,
    likeCard,
    searchTag,
  } = useCardInteractions(work, pages, mediaRef);

  return (
    <article
      className="kami-enter group"
      data-layout={layout}
      data-aspect={String(aspect)}
      style={
        {
          animationDelay: `${Math.min(index, 12) * 40}ms`,
          ["--card-aspect"]: String(aspect),
        } as CSSProperties
      }
      onMouseEnter={armPrefetch}
      onMouseLeave={cancelPrefetch}
      onContextMenu={(e) => {
        e.preventDefault();
        hidePreview();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className={cn("kami-card-shell relative", inVault && variant !== "vault" && "kami-card-folded")}>
        {selection ? (
          <button
            type="button"
            aria-label={selection.checked ? "取消选择" : "选择"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              selection.onToggle();
            }}
            className={cn(
              "absolute left-2 top-2 z-20 grid size-7 place-items-center rounded-full border backdrop-blur-sm transition-colors",
              selection.checked
                ? "border-transparent bg-accent text-accent-fg"
                : "border-white/50 bg-black/35 text-transparent hover:bg-black/50 hover:text-white/70",
            )}
          >
            <Check className="size-4" />
          </button>
        ) : null}
        <div className="relative">
        <Link
          to="/work/$source/$id"
          params={{ source: work.source, id: work.id }}
          className="block"
        >
          <div
            ref={mediaRef}
            className="kami-card-media relative overflow-hidden bg-elevated"
            onMouseEnter={showPreview}
            onMouseLeave={hidePreview}
          >
            {hasMedia ? (
              ugoira ? (
                <UgoiraCover
                  id={work.id}
                  poster={cover}
                  alt={work.title}
                  priority={index < 4}
                  hidden={Boolean(preview)}
                  className={cn(
                    "size-full transition-[transform,opacity] duration-200 ease-out",
                    preview ? "opacity-0" : "group-hover:scale-[1.04]",
                  )}
                />
              ) : (
                <ProxiedImg
                  src={cover}
                  alt={work.title}
                  priority={index < 4}
                  sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 240px"
                  viewTransitionName={`kami-${work.source}-${work.id}`}
                  className={cn(
                    "size-full object-cover transition-[transform,opacity] duration-200 ease-out",
                    preview ? "opacity-0" : "group-hover:scale-[1.04]",
                  )}
                />
              )
            ) : (
              <div className="flex size-full items-end bg-surface px-3 py-3">
                <p className="line-clamp-5 text-sm leading-relaxed text-muted">
                  {work.excerpt || work.title || "无封面"}
                </p>
              </div>
            )}
            {work.restricted ? (
              <div className="absolute inset-0 flex items-center justify-center bg-overlay">
                <Lock className="size-6 text-fg" />
              </div>
            ) : null}
            {marks && marks.length > 0 ? (
              <div className="absolute left-2 top-2 z-10 flex flex-col items-start gap-2">
                {marks.map((label) => (
                  <span key={label} className="kami-slip">
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
            {isAiWork(work) ? (
              <Badge
                className={cn(
                  "absolute bg-bg/80 text-fg",
                  marks && marks.length > 0 ? "left-2 top-10" : "left-2 top-2",
                )}
              >
                AI
              </Badge>
            ) : null}
            {work.pageCount > 1 || work.illustType === 2 ? (
              <div className="absolute right-2 top-2 z-10 flex flex-row items-center gap-1">
                {work.pageCount > 1 ? (
                  <Badge className="bg-bg/80 text-fg">{work.pageCount}p</Badge>
                ) : null}
                {work.illustType === 2 ? <Badge className="bg-bg/80 text-fg">GIF</Badge> : null}
              </div>
            ) : null}
            {resolution ? (
              <Badge className="absolute bottom-2 right-2 z-10 bg-bg/80 font-normal tabular-nums text-fg">
                {resolution}
              </Badge>
            ) : null}
            {pages.length > 1 ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                {pages.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 rounded-full bg-bg/80",
                      i === pageI ? "w-3" : "w-1 opacity-70",
                    )}
                  />
                ))}
              </div>
            ) : null}
            {pages.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="上一页图"
                  className="absolute left-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-bg/70 text-fg opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hidePreview();
                    setPageI((i) => (i - 1 + pages.length) % pages.length);
                  }}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="下一页图"
                  className="absolute right-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-bg/70 text-fg opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hidePreview();
                    setPageI((i) => (i + 1) % pages.length);
                  }}
                >
                  <ChevronRight className="size-4" />
                </button>
              </>
            ) : null}
            {inVault ? (
              <Badge className="absolute bottom-2 right-2 gap-1 bg-bg/80 text-fg">
                <Check className="size-3" />
                已收入
              </Badge>
            ) : null}
            {work.feeRequired ? (
              <Badge className="absolute bottom-2 left-2 bg-bg/80 text-fg">¥{work.feeRequired}</Badge>
            ) : null}
            {work.rating && isBooru(work.source) && isNsfwRating(work.rating, work.source) ? (
              <Badge className="absolute bottom-2 left-2 bg-bg/80 text-fg">R-18</Badge>
            ) : null}
          </div>
        </Link>
        <CardActionTray
          work={work}
          variant={variant}
          inVault={inVault}
          inQueue={inQueue}
          liked={liked}
          liking={liking}
          heartPop={heartPop}
          onExport={onExport}
          onDelete={onDelete}
          saveCard={saveCard}
          queueCard={queueCard}
          likeCard={likeCard}
          hidePreview={hidePreview}
        />
        </div>
        <CardCaption work={work} resolution={resolution} searchTag={searchTag} />
      </div>
      <CardMenu
        work={work}
        pos={menu}
        onClose={() => setMenu(null)}
        onQueue={() => {
          setMenu(null);
          queueCard();
        }}
      />
      {work.thumb ? (
        <HoverPreview
          open={Boolean(preview)}
          src={cover}
          alt={work.title}
          aspect={aspect}
          anchor={preview}
          ugoiraId={ugoira ? work.id : undefined}
        />
      ) : null}
    </article>
  );
}
