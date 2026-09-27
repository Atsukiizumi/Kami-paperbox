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
import { displayTag, isTagTranslated } from "@/lib/site-tags";
import { useTagLexicon } from "@/lib/tag-lexicon";
import type { CardMenuPos } from "./card-menu";
import { cn } from "@/lib/utils";

export function CardCaption({
  work,
  resolution,
  searchTag,
  viewed,
  onQuickTranslate,
}: {
  work: WorkCard;
  resolution: string;
  searchTag: (tag: string) => void;
  /** 浏览历史命中（T）：题注里打个静默小标，扫图不重复点开。 */
  viewed?: boolean;
  /** 未翻 booru tag 右键快译（T4）：不传则右键维持卡级菜单，零影响。 */
  onQuickTranslate?: (tag: string, pos: CardMenuPos) => void;
}) {
  // 词表订阅：rows 变化即重渲本卡（T4 右键补录后译文与弱标记即时热更），值本身不直接用
  useTagLexicon((s) => s.rows);
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
            {viewed ? <span className="ml-1 align-middle text-[10px] font-normal text-subtle">看过</span> : null}
          </h3>
        </Link>
        <p className="line-clamp-1 text-xs text-muted">
          <CardAuthor work={work} onSearch={searchTag} />
          {resolution ? <span className="text-subtle"> · {resolution}</span> : null}
        </p>
        <p className="flex min-w-0 items-center gap-x-1 overflow-hidden text-xs text-subtle">
          {work.tags.length > 0
            ? work.tags.slice(0, 3).map((tag, i) => {
                const translated = isTagTranslated(work.source, tag);
                return (
                  <span key={`${tag}-${i}`} className="flex min-w-0 items-center gap-x-1">
                    {i > 0 ? <span className="shrink-0">·</span> : null}
                    <button
                      type="button"
                      // 未翻的 booru tag：title 留原文便于复制去补录；有翻译维持搜索提示
                      title={translated ? `搜索「${displayTag(work.source, tag)}」` : `未翻译：${tag}`}
                      // 弱标记（虚点下划线）：常态虚点、悬停随既有 hover:underline 变实线
                      className={cn(
                        "truncate transition-colors hover:text-fg hover:underline",
                        !translated &&
                          "underline decoration-dotted decoration-subtle/70 underline-offset-2 hover:decoration-solid",
                      )}
                      onClick={() => searchTag(tag)}
                      onContextMenu={
                        !translated && onQuickTranslate
                          ? (e) => {
                              // 拦在题注上：不弹卡级菜单（stopPropagation），交给快译流程
                              e.preventDefault();
                              e.stopPropagation();
                              onQuickTranslate(tag, { x: e.clientX, y: e.clientY });
                            }
                          : undefined
                      }
                    >
                      {displayTag(work.source, tag)}
                    </button>
                  </span>
                );
              })
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
