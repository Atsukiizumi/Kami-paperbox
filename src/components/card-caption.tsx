"use client";

/**
 * 卡片题注：标题链接、作者（可点进作者页 / 搜作者）、分辨率、标签行。
 *
 * 作用：封面下面两行信息的渲染；CardAuthor 按站点把作者渲染成链接或搜索按钮。
 * 用法：ArtworkCard 底部渲染；searchTag 由 use-card-interactions 提供。
 * 为什么：题注纯属展示接线，抽走后卡片本体只剩媒体区布局。
 */
import { Link } from "@/lib/kami-link";
import type { WorkCard } from "@/lib/types";
import { isBooru } from "@/lib/sites";
import { displayTag } from "@/lib/site-tags";

export function CardCaption({
  work,
  resolution,
  searchTag,
}: {
  work: WorkCard;
  resolution: string;
  searchTag: (tag: string) => void;
}) {
  return (
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
