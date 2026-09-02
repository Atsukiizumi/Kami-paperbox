/**
 * 浏览卡片。
 *
 * 作用：封面 + 两行标题 + 作者/分辨率/标签；封面上可保存、入队，Pixiv 可点红心。
 * 用法：ArtworkGrid 包一层 MasonryBoard。无封面（FANBOX 文本投稿）改显示摘要。
 * 为什么：标题至少两行、卡片有最小宽度，避免竖图被挤成「私…」。
 *        保存/入队/红心叠在封面上，不占标题宽度。
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, ChevronLeft, ChevronRight, Download, Heart, ListOrdered, Lock, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CardMenu, type CardMenuPos } from "@/components/card-menu";
import { HoverPreview, canHoverPreview } from "@/components/hover-preview";
import { cardAspect, cardLayout } from "@/lib/card-aspect";
import type { WorkCard } from "@/lib/types";
import { enqueueWork } from "@/lib/queue-runner";
import { flyPaperToQueue, rectFromEvent } from "@/lib/paper-fly";
import { cookiesFromSettings, useQueue, useSettings } from "@/lib/store";
import { mutateSource } from "@/lib/source";
import { patchCachedWork, prefetchWork } from "@/lib/work-cache";
import { isBooru } from "@/lib/sites";
import { canonicalTag, displayTag } from "@/lib/site-tags";
import { isNsfwRating } from "@/lib/booru";
import { isAiWork } from "@/lib/pixiv-feed";
import { workKey } from "@/lib/vault";
import { useVaultIndex } from "@/lib/vault-index";
import { cn, formatResolution } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { ProxiedImg, warmMedia } from "./proxied-img";
import { upgradeThumbUrl } from "@/lib/thumb-url";
import { pageThumbUrls } from "@/lib/page-thumbs";
import { MasonryBoard } from "./masonry-board";
import { EmptySheet } from "./empty-sheet";

const SKELETON_ASPECT = 3 / 4;
/** 悬停预览要等够久，才能先点到封面上的红心、纸匣和队列。 */
const PREVIEW_HOVER_MS = 520;

export function ArtworkCard({
  work,
  index = 0,
  variant = "browse",
  marks,
  onExport,
  onDelete,
}: {
  work: WorkCard;
  index?: number;
  variant?: "browse" | "vault";
  marks?: string[];
  onExport?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
}) {
  const hasMedia = Boolean(work.thumb);
  const pages = pageThumbUrls(work.thumb, work.pageCount);
  const aspect = hasMedia ? cardAspect(work.width, work.height) : 5 / 3;
  const layout = hasMedia ? cardLayout(work.width, work.height) : "wide";
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const inVault = useVaultIndex((s) => Boolean(s.keys[workKey(work.source, work.id)]));
  const inQueue = useQueue((s) =>
    s.items.some(
      (x) => x.key === workKey(work.source, work.id) && (x.status === "queued" || x.status === "running"),
    ),
  );
  const liked = Boolean(work.liked || work.bookmarked);
  const resolution = formatResolution(work.width, work.height);
  const [saving, setSaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const [heartPop, setHeartPop] = useState(false);
  const [savedPop, setSavedPop] = useState(false);
  const [menu, setMenu] = useState<CardMenuPos | null>(null);
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const [pageI, setPageI] = useState(0);
  const hoverTimer = useRef(0);
  const previewTimer = useRef(0);
  const mediaRef = useRef<HTMLDivElement>(null);
  const cover = pages[Math.min(pageI, Math.max(0, pages.length - 1))] ?? work.thumb;

  function armPrefetch() {
    window.clearTimeout(hoverTimer.current);
    if (work.thumb) warmMedia(upgradeThumbUrl(cover || work.thumb));
    hoverTimer.current = window.setTimeout(() => {
      prefetchWork(queryClient, work.source, work.id);
    }, 160);
  }

  function showPreview() {
    if (!hasMedia || work.restricted || menu || !canHoverPreview()) return;
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const box = mediaRef.current?.getBoundingClientRect();
      if (box) setPreview(box);
    }, PREVIEW_HOVER_MS);
  }

  function hidePreview() {
    window.clearTimeout(previewTimer.current);
    setPreview(null);
  }

  function cancelPrefetch() {
    window.clearTimeout(hoverTimer.current);
    hidePreview();
  }

  async function saveCard(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    hidePreview();
    if (work.restricted) return;
    enqueueWork(work, "vault");
    flyPaperToQueue(e ? rectFromEvent(e.currentTarget) : mediaRef.current?.getBoundingClientRect());
    toast.success("已加入队列：收入纸匣");
  }

  function queueCard(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    hidePreview();
    if (work.restricted) return;
    enqueueWork(work, "download");
    flyPaperToQueue(e ? rectFromEvent(e.currentTarget) : mediaRef.current?.getBoundingClientRect());
    toast.success("已加入队列：下载");
  }

  async function likeCard(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (work.source !== "pixiv" || liking) return;
    if (liked) {
      toast.success("已经点过红心");
      return;
    }
    if (!pixivCookie) {
      toast.error("先在设置里添加 Pixiv 账号");
      return;
    }
    setLiking(true);
    setHeartPop(true);
    patchCachedWork(queryClient, work.source, work.id, { liked: true, bookmarked: true });
    try {
      await mutateSource({
        data: { op: "pixivLike", id: work.id, tags: work.tags, ...cookiesFromSettings() },
      });
    } catch (err) {
      patchCachedWork(queryClient, work.source, work.id, { liked: false, bookmarked: false });
      setHeartPop(false);
      toast.error(err instanceof Error ? err.message : "红心失败");
    } finally {
      setLiking(false);
    }
  }

  function searchTag(tag: string) {
    const word = canonicalTag(work.source, tag) || tag.trim();
    if (!word) return;
    setTab(work.source);
    setBrowseQuery(word, true);
    void navigate({ to: "/" });
  }

  useEffect(() => {
    if (!preview) return;
    const hide = () => {
      window.clearTimeout(previewTimer.current);
      setPreview(null);
    };
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [preview]);

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
            {work.illustType === 2 ? (
              <span
                className={cn(
                  "absolute flex size-8 items-center justify-center rounded-full bg-bg/80 text-fg",
                  marks && marks.length > 0 ? "left-2 top-10" : "left-2 top-2",
                )}
              >
                <Play className="size-3.5" />
              </span>
            ) : null}
            {isAiWork(work) ? (
              <Badge
                className={cn(
                  "absolute bg-bg/80 text-fg",
                  marks && marks.length > 0 ? "left-2 top-10" : work.illustType === 2 ? "left-12 top-2" : "left-2 top-2",
                )}
              >
                AI
              </Badge>
            ) : null}
            {work.pageCount > 1 || resolution ? (
              <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                {work.pageCount > 1 ? (
                  <Badge className="bg-bg/80 text-fg">{work.pageCount}p</Badge>
                ) : null}
                {resolution ? (
                  <Badge className="bg-bg/80 font-normal tabular-nums text-fg">{resolution}</Badge>
                ) : null}
              </div>
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end p-2 opacity-100 transition-[opacity,transform] duration-200 ease-out md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
          <div className="kami-action-tray">
          {variant === "vault" ? (
            <>
              {onExport ? (
                <CardIconButton label="导出" onClick={onExport} onHover={hidePreview}>
                  <Download className="size-4" />
                </CardIconButton>
              ) : null}
              {onDelete ? (
                <CardIconButton label="从纸匣移除" onClick={onDelete} onHover={hidePreview}>
                  <Trash2 className="size-4" />
                </CardIconButton>
              ) : null}
            </>
          ) : (
            <>
              <CardIconButton
                label={inVault ? "已在纸匣" : "收入纸匣"}
                disabled={saving || work.restricted}
                active={inVault}
                onClick={(e) => void saveCard(e)}
                onHover={hidePreview}
              >
                {inVault ? (
                  <Check className={cn("size-4", savedPop && "kami-pop-heart")} />
                ) : (
                  <Archive className={cn("size-4", saving && "animate-pulse")} />
                )}
              </CardIconButton>
              <CardIconButton
                label={inQueue ? "已在队列" : "加入队列"}
                disabled={work.restricted}
                active={inQueue}
                onClick={(e) => queueCard(e)}
                onHover={hidePreview}
              >
                <ListOrdered className="size-4" />
              </CardIconButton>
              {work.source === "pixiv" ? (
                <CardIconButton
                  label={liked ? "已红心" : "红心"}
                  disabled={liking}
                  active={liked}
                  onClick={(e) => void likeCard(e)}
                  onHover={hidePreview}
                >
                  <Heart className={cn("size-4", liked && "fill-current text-danger", heartPop && "kami-pop-heart")} />
                </CardIconButton>
              ) : null}
            </>
          )}
          </div>
        </div>
        </div>
        <div className="kami-card-caption flex h-[5.5rem] items-start gap-1 overflow-hidden px-3 py-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <Link
              to="/work/$source/$id"
              params={{ source: work.source, id: work.id }}
              className="block"
            >
              <h3
                className="line-clamp-2 text-sm font-medium leading-snug tracking-tight text-fg"
                title={work.title || "无题"}
              >
                {work.title || "无题"}
              </h3>
            </Link>
            <p className="line-clamp-1 text-xs text-muted">
              <CardAuthor work={work} onSearch={searchTag} />
              {resolution ? <span className="text-subtle"> · {resolution}</span> : null}
            </p>
            <p className="flex min-w-0 items-center gap-x-1 overflow-hidden text-xs text-subtle">
              {work.tags.length > 0
                ? work.tags.slice(0, 3).map((tag, i) => (
                    <span key={`${tag}-${i}`} className="flex min-w-0 items-center gap-x-1">
                      {i > 0 ? <span className="shrink-0">·</span> : null}
                      <button
                        type="button"
                        title={`搜索「${displayTag(work.source, tag)}」`}
                        className="truncate transition-colors hover:text-fg hover:underline"
                        onClick={() => searchTag(tag)}
                      >
                        {displayTag(work.source, tag)}
                      </button>
                    </span>
                  ))
                : "\u00a0"}
            </p>
          </div>
        </div>
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
        />
      ) : null}
    </article>
  );
}

function CardAuthor({
  work,
  onSearch,
}: {
  work: WorkCard;
  onSearch: (tag: string) => void;
}) {
  const className = "transition-colors hover:text-fg hover:underline";
  if (work.source === "pixiv" && work.authorId) {
    return (
      <Link to="/user/$id" params={{ id: work.authorId }} className={className}>
        {work.author}
      </Link>
    );
  }
  if (work.source === "fanbox" && work.authorId) {
    return (
      <Link to="/creator/$id" params={{ id: work.authorId }} className={className}>
        {work.author}
      </Link>
    );
  }
  if (isBooru(work.source) && work.author) {
    return (
      <button type="button" className={className} onClick={() => onSearch(work.author)}>
        {work.author}
      </button>
    );
  }
  return <span>{work.author}</span>;
}

function CardIconButton({
  label,
  children,
  onClick,
  onHover,
  disabled,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onHover?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "pointer-events-auto flex size-8 items-center justify-center rounded-full text-fg",
        "transition-[transform,background-color,color] duration-150",
        "hover:bg-elevated active:scale-[0.96] disabled:opacity-50",
        active && "text-accent",
      )}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      {children}
    </button>
  );
}

export function ArtworkGrid({
  items,
  empty,
  marksOf,
}: {
  items: WorkCard[];
  empty?: string;
  marksOf?: (work: WorkCard) => string[] | undefined;
}) {
  if (items.length === 0) {
    return <EmptySheet title={empty ?? "没有符合条件的作品。"} hint="换个站点或标签再看。" />;
  }
  return (
    <MasonryBoard>
      {items.map((work, i) => (
        <ArtworkCard key={`${work.source}-${work.id}`} work={work} index={i} marks={marksOf?.(work)} />
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
