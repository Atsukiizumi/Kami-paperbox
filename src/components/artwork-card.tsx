/**
 * 浏览卡片。
 *
 * 作用：封面 + 两行标题 + 作者/分辨率/标签；封面上可直接保存、Pixiv 可点红心。
 * 用法：ArtworkGrid 包一层 MasonryBoard。无封面（FANBOX 文本投稿）改显示摘要。
 * 为什么：标题至少两行、卡片有最小宽度，避免竖图被挤成「私…」。
 *        保存/红心叠在封面上，不占标题宽度。
 */
import { useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Download, ExternalLink, Heart, Lock, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cardAspect, cardLayout, type CardLayout } from "@/lib/card-aspect";
import type { WorkCard } from "@/lib/types";
import { enqueueWork, saveWorkNow } from "@/lib/queue-runner";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { mutateSource } from "@/lib/source";
import { patchCachedWork } from "@/lib/work-cache";
import { isBooru, workOriginUrl } from "@/lib/sites";
import { isNsfwRating } from "@/lib/booru";
import { isAiWork } from "@/lib/pixiv-feed";
import { workKey } from "@/lib/vault";
import { useVaultIndex } from "@/lib/vault-index";
import { cn, formatResolution } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { ProxiedImg } from "./proxied-img";
import { MasonryBoard } from "./masonry-board";
import { Skeleton } from "./ui/skeleton";

const SKELETONS: { aspect: number; layout: CardLayout }[] = [
  { aspect: 0.75, layout: "tile" },
  { aspect: 1.6, layout: "wide" },
  { aspect: 0.62, layout: "tile" },
  { aspect: 0.8, layout: "tile" },
  { aspect: 1.45, layout: "wide" },
  { aspect: 0.52, layout: "tile" },
  { aspect: 2.4, layout: "banner" },
  { aspect: 0.68, layout: "tile" },
];

export function ArtworkCard({
  work,
  index = 0,
  variant = "browse",
  onExport,
  onDelete,
}: {
  work: WorkCard;
  index?: number;
  variant?: "browse" | "vault";
  onExport?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
}) {
  const hasMedia = Boolean(work.thumb);
  const aspect = hasMedia ? cardAspect(work.width, work.height) : 5 / 3;
  const layout = hasMedia ? cardLayout(work.width, work.height) : "wide";
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const queryClient = useQueryClient();
  const inVault = useVaultIndex((s) => Boolean(s.keys[workKey(work.source, work.id)]));
  const liked = Boolean(work.liked);
  const resolution = formatResolution(work.width, work.height);
  const [saving, setSaving] = useState(false);
  const [liking, setLiking] = useState(false);

  async function saveCard(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (saving || work.restricted) return;
    if (inVault) {
      toast.success("已在纸匣");
      return;
    }
    setSaving(true);
    try {
      await saveWorkNow(work, { download: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function likeCard(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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
    try {
      await mutateSource({ data: { op: "pixivLike", id: work.id, ...cookiesFromSettings() } });
      patchCachedWork(queryClient, work.source, work.id, { liked: true });
      toast.success("已点红心");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "红心失败");
    } finally {
      setLiking(false);
    }
  }

  return (
    <article
      className="kami-enter group"
      data-layout={layout}
      data-aspect={String(aspect)}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="kami-card-shell">
        <div className="relative">
        <Link
          to="/work/$source/$id"
          params={{ source: work.source, id: work.id }}
          className="block"
        >
          <div
            className="kami-card-media relative overflow-hidden bg-elevated"
            style={{ aspectRatio: aspect }}
          >
            {hasMedia ? (
              <ProxiedImg
                src={work.thumb}
                alt={work.title}
                priority={index < 4}
                sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 240px"
                className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
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
            {work.illustType === 2 ? (
              <span className="absolute left-2 top-2 flex size-8 items-center justify-center rounded-full bg-bg/80 text-fg">
                <Play className="size-3.5" />
              </span>
            ) : null}
            {isAiWork(work) ? (
              <Badge
                className={cn(
                  "absolute top-2 bg-bg/80 text-fg",
                  work.illustType === 2 ? "left-12" : "left-2",
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end gap-1 bg-gradient-to-t from-bg/70 via-bg/20 to-transparent p-2 opacity-100 transition-[opacity,transform] duration-200 ease-out md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
          {variant === "vault" ? (
            <>
              {onExport ? (
                <CardIconButton label="导出" onClick={onExport}>
                  <Download className="size-4" />
                </CardIconButton>
              ) : null}
              {onDelete ? (
                <CardIconButton label="从纸匣移除" onClick={onDelete}>
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
              >
                {inVault ? (
                  <Check className="size-4" />
                ) : (
                  <Archive className={cn("size-4", saving && "animate-pulse")} />
                )}
              </CardIconButton>
              {work.source === "pixiv" ? (
                <CardIconButton
                  label={liked ? "已红心" : "红心"}
                  disabled={liking}
                  active={liked}
                  onClick={(e) => void likeCard(e)}
                >
                  <Heart className={cn("size-4", liked && "fill-current text-danger")} />
                </CardIconButton>
              ) : null}
            </>
          )}
        </div>
        </div>
        <div className="flex h-[5.5rem] items-start gap-1 overflow-hidden px-3 py-2">
          <Link
            to="/work/$source/$id"
            params={{ source: work.source, id: work.id }}
            className="min-w-0 flex-1 space-y-0.5"
          >
            <h3 className="line-clamp-2 text-sm font-medium leading-snug tracking-tight text-fg">
              {work.title || "无题"}
            </h3>
            <p className="line-clamp-1 text-xs text-muted">
              {work.author}
              {resolution ? <span className="text-subtle"> · {resolution}</span> : null}
            </p>
            <p className="line-clamp-1 text-xs text-subtle">
              {work.tags.length > 0
                ? work.tags
                    .slice(0, 3)
                    .map((t) => t.replace(/_/g, " "))
                    .join(" · ")
                : "\u00a0"}
            </p>
          </Link>
          {variant === "browse" ? (
          <button
            type="button"
            aria-label="加入队列"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted",
              "transition-[opacity,transform,background-color,color] duration-150",
              "hover:bg-elevated hover:text-fg active:scale-[0.96]",
              "opacity-100 md:opacity-0 md:group-hover:opacity-100",
            )}
            onClick={() => enqueueWork(work)}
          >
            <Download className="size-4" />
          </button>
          ) : null}
          <a
            href={workOriginUrl(work.source, work.id, work.authorId)}
            target="_blank"
            rel="noreferrer"
            title="原始链接"
            aria-label="打开原始链接"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-[opacity,transform,background-color,color] duration-150 hover:bg-elevated hover:text-fg active:scale-[0.96] opacity-100 md:opacity-0 md:group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>
    </article>
  );
}

function CardIconButton({
  label,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
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
        "pointer-events-auto flex size-9 items-center justify-center rounded-full bg-bg/85 text-fg shadow-sm",
        "transition-[transform,background-color,color] duration-150",
        "hover:bg-bg active:scale-[0.96] disabled:opacity-50",
        active && "text-accent",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ArtworkGrid({
  items,
  empty,
}: {
  items: WorkCard[];
  empty?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted">{empty ?? "没有符合条件的作品。"}</p>
    );
  }
  return (
    <MasonryBoard>
      {items.map((work, i) => (
        <ArtworkCard key={`${work.source}-${work.id}`} work={work} index={i} />
      ))}
    </MasonryBoard>
  );
}

export function ArtworkGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <MasonryBoard>
      {Array.from({ length: count }).map((_, i) => {
        const item = SKELETONS[i % SKELETONS.length];
        return (
          <article
            key={i}
            className="kami-enter"
            data-layout={item.layout}
            data-aspect={String(item.aspect)}
            style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
          >
            <div className="overflow-hidden rounded-xl bg-surface">
              <Skeleton
                className="kami-card-media w-full rounded-none"
                style={{
                  aspectRatio: item.aspect,
                  ["--shimmer-delay" as string]: `${(i % 6) * 0.12}s`,
                }}
              />
              <div className="space-y-2 px-3 py-3">
                <Skeleton className="h-3 w-4/5 rounded-md" />
                <Skeleton className="h-2.5 w-2/5 rounded-md" />
              </div>
            </div>
          </article>
        );
      })}
    </MasonryBoard>
  );
}
