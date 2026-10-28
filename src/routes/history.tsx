/**
 * 历史浏览。
 *
 * 作用：列出最近打开过的作品和作者，点卡片回到详情 / 画师页。
 * 用法：侧栏「历史」。打开作品或画师页时自动写入。
 * 为什么：浏览器自己的后退不够看「上周点过哪张 / 哪位」。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { useMemo, useState } from "react";
import { ArtworkGrid } from "@/components/artwork-card";
import { Button } from "@/components/ui/button";
import { EmptySheet } from "@/components/empty-sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HISTORY_DAYS, historyToCard, useViewHistory, type AuthorHistoryEntry } from "@/lib/view-history";
import { SITE_LIST, siteLabel } from "@/lib/sites";
import type { Source } from "@/lib/types";

function authorHref(author: AuthorHistoryEntry) {
  if (author.source === "fanbox") return { to: "/creator/$id" as const, params: { id: author.id } };
  return { to: "/user/$id" as const, params: { id: author.id } };
}

export function HistoryPage() {
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
          <h1 className="kami-node-title text-3xl md:text-4xl">历史浏览</h1>
          <p className="kami-node-note">最近打开过的作品和作者，保留 {HISTORY_DAYS} 天，只存在这台浏览器。</p>
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
      {visibleItems.length > 0 || visibleAuthors.length > 0 ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_11rem]">
          {visibleItems.length > 0 ? (
            <section className="order-2 min-w-0 space-y-3 lg:order-1">
              <h2 className="kami-dk-label">作品 {String(visibleItems.length).padStart(2, "0")}</h2>
              <ArtworkGrid items={visibleItems.map(historyToCard)} empty="还没有作品历史。" />
            </section>
          ) : null}
          {visibleAuthors.length > 0 ? (
            <aside className="order-1 min-w-0 lg:sticky lg:top-16 lg:order-2">
              <h2 className="kami-dk-label">画师 {String(visibleAuthors.length).padStart(2, "0")}</h2>
              <ul className="mt-2">
                {visibleAuthors.map((author) => {
                  const href = authorHref(author);
                  return (
                    <li key={`${author.source}:${author.id}`}>
                      <Link
                        to={href.to}
                        params={href.params}
                        className="flex items-baseline justify-between gap-2 border-b border-border py-2 text-sm text-fg hover:text-fg"
                      >
                        <span className="truncate">{author.name}</span>
                        <span className="shrink-0 text-xs text-muted">{siteLabel(author.source)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
