"use client";

/**
 * 纸匣统计页（重设计：hero → 用户画像 → 明细统计三层版式）。
 *
 * 作用：hero 数字带（count-up）→ 用户画像（收藏节奏 / 心仪画师 / 兴趣标签 /
 *      来源构成 / 画像小结，聚合走 vault-profile.ts 纯函数）→ 明细统计
 *      （按月时间线 / 存储占用 / 查重状态）。
 * 用法：/vault/stats，入口在纸匣页头部。
 * 为什么：原先是六个同构 BarList 的 2 列平铺，信息密度低、像通用仪表盘，
 *        违背「不是仪表盘」的定位。数据流不变：listVault() 一份全量 meta
 *        喂画像与分布，服务端存储 / 查重两路各自降级、互不拖垮。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/kami-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptySheet } from "@/components/empty-sheet";
import { HeroStrip } from "@/components/stats/hero-strip";
import { RhythmClock } from "@/components/stats/rhythm-clock";
import { ArtistBoard, BarRow } from "@/components/stats/artist-board";
import { TagCloud } from "@/components/stats/tag-cloud";
import { SourceBar } from "@/components/stats/source-bar";
import { SummarySlip } from "@/components/stats/summary-slip";
import { Reveal } from "@/components/stats/reveal";
import { listVault } from "@/lib/storage/vault";
import { monthOf, vaultAuthors, vaultTags, vaultTotals } from "@/lib/storage/vault-query";
import {
  hourHistogram,
  profileSummary,
  sourceComposition,
  tagCloud,
  weekdayHistogram,
} from "@/lib/storage/vault-profile";
import { applyAuthorAlias, clusterAuthorVariants } from "@/lib/author-name";
import { useSettings } from "@/lib/store";
import { formatBytes } from "@/lib/utils";
import type { VaultMeta } from "@/lib/types";

type StorageRow = { name: string; bytes: number; count: number };
type StorageResponse = { ok: boolean; bySource?: StorageRow[]; byAuthor?: StorageRow[] };
type DedupResponse = { ok: boolean; hashed?: number; total?: number; groups?: unknown[] };

/**
 * 心仪画师 Top N：按 authorKey 簇计数（同 authorId / 规范化同名归一），
 * 展示名 = 簇内最新 raw 经规范化再套用户别名；无名作者归「(未命名)」。
 */
function topAuthors(
  items: VaultMeta[],
  n: number,
  aliases?: Record<string, string>,
): { name: string; count: number }[] {
  const rows = clusterAuthorVariants(items).map((c) => ({
    name: applyAuthorAlias(c.displayName, aliases) || "(未命名)",
    count: c.totalCount,
  }));
  return rows.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, n);
}

function monthlyTimeline(items: VaultMeta[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const m = monthOf(item.savedAt);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12).map(([name, count]) => ({ name, count }));
}

export function VaultStatsPage() {
  // null = 还在清点（IDB 未返回），与「空匣」区分开，空态才不会闪。
  const [all, setAll] = useState<VaultMeta[] | null>(null);
  const [storage, setStorage] = useState<StorageResponse | null>(null);
  const [dedup, setDedup] = useState<DedupResponse | null>(null);
  const authorAliases = useSettings((s) => s.authorAliases);
  // 标签别名（标签整理）：标签数与词云按归一后口径统计，变体不再分票
  const tagAliases = useSettings((s) => s.tagAliases);

  useEffect(() => {
    void listVault().then(setAll).catch(() => setAll([]));
    void fetch("/api/vault/stats/storage", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStorage)
      .catch(() => setStorage(null));
    void fetch("/api/vault/dedup", { cache: "no-store" })
      .then((r) => r.json())
      .then(setDedup)
      .catch(() => setDedup(null));
  }, []);

  const items = all ?? [];
  // 派生全部吃 all（null 时按空数组算），依赖只有 all 一个，不清点完不闪画像。
  const totals = useMemo(() => vaultTotals(all ?? []), [all]);
  const authorCount = useMemo(() => (all ? vaultAuthors(all, authorAliases).length : 0), [all, authorAliases]);
  const tagCount = useMemo(() => (all ? vaultTags(all, tagAliases).length : 0), [all, tagAliases]);
  const hours = useMemo(() => hourHistogram(all ?? []), [all]);
  const weekdays = useMemo(() => weekdayHistogram(all ?? []), [all]);
  const artists = useMemo(() => topAuthors(all ?? [], 10, authorAliases), [all, authorAliases]);
  const chips = useMemo(() => tagCloud(all ?? [], { limit: 40, tagAliases }), [all, tagAliases]);
  const sources = useMemo(() => sourceComposition(all ?? []), [all]);
  const summary = useMemo(() => profileSummary(all ?? [], authorAliases), [all, authorAliases]);
  const timeline = useMemo(() => monthlyTimeline(all ?? []), [all]);

  const storageRows = (storage?.bySource ?? []).slice(0, 8).map((r) => ({ name: r.name, bytes: r.bytes }));
  const storageMax = Math.max(1, ...storageRows.map((r) => r.bytes));
  const timelineMax = Math.max(1, ...timeline.map((r) => r.count));
  const hashed = dedup?.hashed ?? 0;
  const total = dedup?.total ?? items.length;
  const groupCount = Array.isArray(dedup?.groups) ? dedup.groups.length : 0;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">纸匣统计</h1>
          <p className="mt-1 text-sm text-muted">
            共 {totals.count} 条 · {formatBytes(totals.bytes)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link to="/vault/report">年度报告</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/vault">回纸匣</Link>
          </Button>
        </div>
      </header>

      {all === null ? (
        <p className="text-sm text-muted">正在清点纸匣…</p>
      ) : all.length === 0 ? (
        <EmptySheet
          title="纸匣还是空的"
          hint="先去浏览，把喜欢的作品收进纸匣；攒下几张，这里就会长出你的收藏画像。"
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/browse">去浏览</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Reveal>
            <HeroStrip count={totals.count} authors={authorCount} tags={tagCount} bytes={totals.bytes} />
          </Reveal>

          <section className="space-y-4" aria-label="用户画像">
            <h2 className="font-display text-xl tracking-tight text-fg">用户画像</h2>
            <Reveal>
              <RhythmClock hours={hours} weekdays={weekdays} />
            </Reveal>
            <Reveal className="grid gap-4 lg:grid-cols-5">
              <ArtistBoard className="lg:col-span-3" rows={artists} />
              <TagCloud className="lg:col-span-2" chips={chips} />
            </Reveal>
            <Reveal className="grid gap-4 lg:grid-cols-5">
              <SourceBar className="lg:col-span-3" rows={sources} />
              <SummarySlip className="lg:col-span-2" summary={summary} />
            </Reveal>
          </section>

          <section className="space-y-4" aria-label="明细统计">
            {/* 明细区不包 Reveal：滚动渐显只给画像区「落纸」的仪式感，长尾明细
                在打印 / 截图 / IO 不触发的场景必须直接可见，不能赌观察器。 */}
            <h2 className="font-display text-xl tracking-tight text-fg">明细统计</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>按月收藏时间线（近 12 个月）</CardTitle>
                </CardHeader>
                <CardContent>
                  {timeline.length === 0 ? (
                    <p className="text-sm text-muted">暂无数据</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {timeline.map((row, i) => (
                        <BarRow
                          key={row.name}
                          name={row.name}
                          value={row.count}
                          max={timelineMax}
                          right={`${row.count} 张`}
                          nameClass="w-16"
                          highlight={i === 0}
                        />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>存储占用（按来源）</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {storage?.ok ? (
                      storageRows.length === 0 ? (
                        <p className="text-sm text-muted">暂无数据</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {storageRows.map((row) => (
                            <BarRow
                              key={row.name}
                              name={row.name}
                              value={row.bytes}
                              max={storageMax}
                              right={formatBytes(row.bytes)}
                            />
                          ))}
                        </ul>
                      )
                    ) : (
                      <CardDescription>服务端统计不可用（本机只读形态正常，重试或检查服务端）。</CardDescription>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>查重状态</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted">
                      哈希覆盖 {hashed}/{total}
                      {groupCount > 0 ? ` · 疑似重复 ${groupCount} 组待处理` : " · 没有待处理重复"}
                    </p>
                    <Button asChild size="sm" variant="secondary">
                      <Link to="/vault">去处理</Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
