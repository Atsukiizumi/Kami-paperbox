/**
 * 历史浏览。
 *
 * 作用：列出最近打开过的作品和作者，点卡片回到详情 / 画师页。
 * 用法：侧栏「历史」。打开作品或画师页时自动写入。
 * 为什么：浏览器自己的后退不够看「上周点过哪张 / 哪位」。
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArtworkGrid } from "@/components/artwork-card";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { EmptySheet } from "@/components/empty-sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HISTORY_DAYS, historyToCard, useViewHistory, type AuthorHistoryEntry } from "@/lib/view-history";
import { SITE_LIST, siteLabel } from "@/lib/sites";
import type { Source } from "@/lib/types";

export const Route = createFileRoute("/history")({ component: HistoryPage });

function authorHref(author: AuthorHistoryEntry) {
  if (author.source === "fanbox") return { to: "/creator/$id" as const, params: { id: author.id } };
  return { to: "/user/$id" as const, params: { id: author.id } };
}

function HistoryPage() {
  const items = useViewHistory((s) => s.items);
  const authors = useViewHistory((s) => s.authors);
  const clear = useViewHistory((s) => s.clear);
  const prune = useViewHistory((s) => s.prune);
  const [source, setSource] = useState<Source | "all">("all");

  const visibleItems = useMemo(
    () => (source === "all" ? items : items.filter((row) => row.source === source)),
    [items, source],
  );
  const visibleAuthors = useMemo(
    () => (source === "all" ? authors : authors.filter((row) => row.source === source)),
    [authors, source],
  );

  const empty = visibleItems.length === 0 && visibleAuthors.length === 0;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">历史浏览</h1>
          <p className="mt-1 text-sm text-muted">最近打开过的作品和作者，保留 {HISTORY_DAYS} 天，只存在这台浏览器。</p>
        </div>
        {!empty || items.length > 0 ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => prune()}>
              清掉过期
            </Button>
            <Button variant="ghost" size="sm" onClick={() => clear()}>
              清空
            </Button>
          </div>
        ) : null}
      </header>
      <ToggleGroup type="single" value={source} onValueChange={(v) => v && setSource(v as Source | "all")}>
        <ToggleGroupItem value="all">全部</ToggleGroupItem>
        {SITE_LIST.map((item) => (
          <ToggleGroupItem key={item.id} value={item.id}>
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {empty ? (
        <EmptySheet title="还没有历史" hint="打开作品或画师页后会记在这里。上一页仍然走浏览器记录。" />
      ) : null}
      {authors.length > 0 && visibleAuthors.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted">作者</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {visibleAuthors.map((author) => {
              const href = authorHref(author);
              return (
                <li key={`${author.source}:${author.id}`}>
                  <Link
                    to={href.to}
                    params={href.params}
                    className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2 transition-colors hover:bg-surface"
                  >
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-full bg-surface">
                      {author.avatar ? (
                        <ProxiedImg src={author.avatar} alt="" fit="cover" className="absolute inset-0 size-full" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-sm text-muted">
                          {(author.name || "?").slice(0, 1)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">{author.name}</span>
                      <span className="block truncate text-xs text-subtle">{siteLabel(author.source)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {visibleItems.length > 0 ? (
        <section className="space-y-3">
          {visibleAuthors.length > 0 ? <h2 className="text-sm font-medium text-muted">作品</h2> : null}
          <ArtworkGrid items={visibleItems.map(historyToCard)} empty="还没有作品历史。" />
        </section>
      ) : null}
    </div>
  );
}
