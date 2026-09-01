/**
 * 快捷标签。
 *
 * 作用：作品页点 tag 搜索/保存；浏览页列出该站已存标签，一点就搜。
 * 用法：SavedTagBar 放浏览搜索框下；WorkTagList 放作品标题下。
 * 为什么：各站写法不同（Pixiv 精确词 vs 图站下划线 AND），芯片自己带 source。
 */
import { Star } from "lucide-react";
import type { Source } from "@/lib/types";
import { canonicalTag, displayTag, isSavedTag, tagHint } from "@/lib/site-tags";
import { cn } from "@/lib/utils";

export function WorkTagList({
  source,
  tags,
  saved,
  onSearch,
  onToggle,
}: {
  source: Source;
  tags: readonly string[];
  saved: readonly string[];
  onSearch: (tag: string) => void;
  onToggle: (tag: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
        {tags.map((tag) => {
          const key = canonicalTag(source, tag) || tag;
          const pinned = isSavedTag(saved, source, tag);
          return (
            <span
              key={key}
              className="inline-flex max-w-full items-center rounded-full bg-elevated text-sm text-muted"
            >
              <button
                type="button"
                title={`搜索「${displayTag(source, tag)}」`}
                className="truncate px-3 py-1 transition-colors hover:text-fg"
                onClick={() => onSearch(tag)}
              >
                {displayTag(source, tag)}
              </button>
              <button
                type="button"
                aria-label={pinned ? "取消保存" : "保存标签"}
                title={pinned ? "取消保存" : "保存为快捷标签"}
                className={cn(
                  "pr-2 transition-colors hover:text-fg",
                  pinned && "text-fg",
                )}
                onClick={() => onToggle(tag)}
              >
                <Star className={cn("size-3.5", pinned && "fill-current")} />
              </button>
            </span>
          );
        })}
      </div>
  );
}

export function SavedTagBar({
  source,
  tags,
  active,
  onSearch,
  onToggle,
  onSaveCurrent,
  current,
}: {
  source: Source;
  tags: readonly string[];
  active?: string;
  current?: string;
  onSearch: (tag: string) => void;
  onToggle: (tag: string) => void;
  onSaveCurrent?: () => void;
}) {
  const currentKey = current ? canonicalTag(source, current) : "";
  const canSaveCurrent = Boolean(currentKey) && !isSavedTag(tags, source, currentKey);
  if (tags.length === 0 && !canSaveCurrent) {
    return <p className="text-xs text-subtle">{tagHint(source)}</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-subtle">快捷标签</span>
        {tags.map((tag) => {
          const on = Boolean(active) && tagEqualsActive(source, tag, active);
          return (
            <span
              key={tag}
              className={cn(
                "inline-flex max-w-full items-center rounded-full text-xs",
                on ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
              )}
            >
              <button
                type="button"
                title={on ? "取消这次搜索" : `搜索「${displayTag(source, tag)}」`}
                className="truncate px-3 py-1 hover:text-fg"
                onClick={() => onSearch(on ? "" : tag)}
              >
                {displayTag(source, tag)}
              </button>
              <button
                type="button"
                aria-label={`取消保存 ${displayTag(source, tag)}`}
                title="从快捷标签去掉"
                className="pr-2 opacity-70 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(tag);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        {canSaveCurrent && onSaveCurrent ? (
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-fg"
            onClick={onSaveCurrent}
            title="只把当前这次搜索钉在快捷标签，点 × 可去掉"
          >
            保存「{displayTag(source, currentKey)}」
          </button>
        ) : null}
      </div>
      <p className="text-xs text-subtle">{tagHint(source)}</p>
    </div>
  );
}

function tagEqualsActive(source: Source, tag: string, active?: string): boolean {
  if (!active) return false;
  return canonicalTag(source, tag) === canonicalTag(source, active);
}
