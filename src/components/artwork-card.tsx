import { Link } from "@tanstack/react-router";
import { Download, ExternalLink, Lock, Play } from "lucide-react";
import { cardAspect } from "@/lib/card-aspect";
import type { WorkCard } from "@/lib/types";
import { enqueueWork } from "@/lib/queue-runner";
import { isBooru, workOriginUrl } from "@/lib/sites";
import { isNsfwRating } from "@/lib/booru";
import { isAiWork } from "@/lib/pixiv-feed";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { ProxiedImg } from "./proxied-img";
import { Skeleton } from "./ui/skeleton";

const SKELETON_ASPECTS = [0.75, 1.2, 0.62, 1.45, 0.8, 0.52, 1.05, 0.68];

export function ArtworkCard({ work, index = 0 }: { work: WorkCard; index?: number }) {
  const aspect = cardAspect(work.width, work.height);
  return (
    <article
      className="kami-enter group"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="overflow-hidden rounded-xl bg-surface transition-[box-shadow] duration-200 ease-out hover:shadow-[var(--shadow-float)]">
        <Link
          to="/work/$source/$id"
          params={{ source: work.source, id: work.id }}
          className="block"
        >
          <div className="relative overflow-hidden bg-elevated" style={{ aspectRatio: aspect }}>
            <ProxiedImg
              src={work.thumb}
              alt={work.title}
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
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
            {work.pageCount > 1 ? (
              <Badge className="absolute right-2 top-2 bg-bg/80 text-fg">{work.pageCount}p</Badge>
            ) : null}
            {work.feeRequired ? (
              <Badge className="absolute bottom-2 left-2 bg-bg/80 text-fg">¥{work.feeRequired}</Badge>
            ) : null}
            {work.rating && isBooru(work.source) && isNsfwRating(work.rating, work.source) ? (
              <Badge className="absolute bottom-2 right-2 bg-bg/80 text-fg">R-18</Badge>
            ) : null}
          </div>
        </Link>
        <div className="flex items-start gap-1 px-3 py-2">
          <Link
            to="/work/$source/$id"
            params={{ source: work.source, id: work.id }}
            className="min-w-0 flex-1 space-y-0.5"
          >
            <h3 className="line-clamp-1 text-sm font-medium tracking-tight text-fg">{work.title || "无题"}</h3>
            <p className="line-clamp-1 text-xs text-muted">{work.author}</p>
            {work.tags.length > 0 ? (
              <p className="line-clamp-1 text-xs text-subtle">
                {work.tags
                  .slice(0, 3)
                  .map((t) => t.replace(/_/g, " "))
                  .join(" · ")}
              </p>
            ) : null}
          </Link>
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
          <a
            href={workOriginUrl(work.source, work.id, work.authorId)}
            target="_blank"
            rel="noreferrer"
            title="原始链接"
            aria-label="打开原始链接"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted",
              "transition-[opacity,transform,background-color,color] duration-150",
              "hover:bg-elevated hover:text-fg active:scale-[0.96]",
              "opacity-100 md:opacity-0 md:group-hover:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>
    </article>
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
    <div className="kami-masonry">
      {items.map((work, i) => (
        <ArtworkCard key={`${work.source}-${work.id}`} work={work} index={i} />
      ))}
    </div>
  );
}

export function ArtworkGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="kami-masonry">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className="rounded-xl"
          style={{ aspectRatio: SKELETON_ASPECTS[i % SKELETON_ASPECTS.length] }}
        />
      ))}
    </div>
  );
}