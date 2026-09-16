"use client";

/**
 * 纸匣年度报告页（回顾三件套 R2）。
 *
 * 作用：选一个年份，把那一年的收藏读成一页叙事长文——开篇大数 → 心头好
 *      Top 3 → 兴趣坐标 Top 5 标签 → 收藏节奏 → 之最 → 结束语。
 * 用法：/vault/report，入口在统计页头部「年度报告」按钮。
 * 为什么：聚合全部走 vault-profile 的年份切片（filterByYear + reportNarrative
 *        复用既有画像函数），页面只拼版不计算；全页不套 Reveal 渐显——报告是
 *        要打印 / 截图的纸面，滚动观察器在这里只会帮倒忙（统计页明细区教训）。
 *        措辞字段 null 即隐藏对应半句（宁缺不编），绝不发明没发生的事。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/kami-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptySheet } from "@/components/empty-sheet";
import { BarRow } from "@/components/stats/artist-board";
import { TagCloud } from "@/components/stats/tag-cloud";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listVault } from "@/lib/storage/vault";
import { filterByYear, reportNarrative, vaultYears } from "@/lib/storage/vault-profile";
import { useCountUp } from "@/lib/use-count-up";
import { useSettings } from "@/lib/store";
import { formatBytes } from "@/lib/utils";
import type { VaultMeta } from "@/lib/types";

/** 同年内只印「M 月 d 日」，年份在页头已经给过。 */
function mdOf(savedAt: number): string {
  const d = new Date(savedAt);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function VaultReportPage() {
  // null = 还在清点（IDB 未返回），与「空匣」「空年份」区分开，空态不闪
  const [all, setAll] = useState<VaultMeta[] | null>(null);
  const [yearPick, setYearPick] = useState<number | null>(null);
  const authorAliases = useSettings((s) => s.authorAliases);
  // 标签别名（标签整理）：兴趣坐标 Top 5 按归一后口径合并变体计数
  const tagAliases = useSettings((s) => s.tagAliases);

  useEffect(() => {
    void listVault().then(setAll).catch(() => setAll([]));
  }, []);

  const years = useMemo(() => vaultYears(all ?? []), [all]);
  const year = yearPick ?? years[0] ?? null;
  const narrative = useMemo(() => {
    if (year === null) return null;
    return reportNarrative(filterByYear(all ?? [], year), year, authorAliases, tagAliases);
  }, [all, year, authorAliases, tagAliases]);
  const heroN = useCountUp(narrative?.total ?? 0);
  const authorMax = Math.max(1, ...(narrative?.topAuthors.map((row) => row.count) ?? [0]));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">年度报告</h1>
          <p className="mt-1 text-sm text-muted">把一年的收藏读回给你看；全部在本机从纸匣元数据算出。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {years.length > 0 ? (
            <Select value={year === null ? "" : String(year)} onValueChange={(v) => setYearPick(Number(v))}>
              <SelectTrigger className="h-9 w-28 rounded-full bg-elevated px-3.5" aria-label="选择年份">
                <SelectValue placeholder="年份" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y} 年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button asChild size="sm" variant="secondary">
            <Link to="/vault/stats">回统计</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/vault">回纸匣</Link>
          </Button>
        </div>
      </header>

      {all === null ? (
        <p className="text-sm text-muted">正在清点纸匣…</p>
      ) : all.length === 0 ? (
        <EmptySheet
          title="纸匣还是空的"
          hint="先去收几张；攒上一年，年底这里会给你一页回忆。"
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/browse">去浏览</Link>
            </Button>
          }
        />
      ) : narrative === null ? (
        <EmptySheet title={`${year ?? "这"}年没有收藏`} hint="换一年看看。" />
      ) : (
        <>
          {/* 1 开篇大数：hero 数字带 count-up，直接坐在书案上（同统计页第一层） */}
          <section aria-label="开篇大数" className="space-y-1">
            <p className="text-sm text-muted">{narrative.year} 年，你收了</p>
            <p className="font-display text-6xl tracking-tight tabular-nums text-fg">
              {Math.round(heroN).toLocaleString("zh-CN")}
              <span className="ml-2 text-2xl text-muted">张</span>
            </p>
            {narrative.peakMonth ? (
              <p className="text-sm text-muted">
                最勤的是 {narrative.peakMonth.label}，一个月收了 {narrative.peakMonth.count} 张。
              </p>
            ) : null}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 2 心头好：画师簇口径与统计页一致（同 authorId / 规范化同名归一） */}
            <Card>
              <CardHeader>
                <CardTitle>心头好 · Top 3</CardTitle>
                <CardDescription>那年收得最多的画师；占比按当年收藏总数。</CardDescription>
              </CardHeader>
              <CardContent>
                {narrative.topAuthors.length > 0 ? (
                  <ul className="space-y-1.5">
                    {narrative.topAuthors.map((row, i) => (
                      <BarRow
                        key={row.name}
                        name={row.name}
                        value={row.count}
                        max={authorMax}
                        right={`${row.count} 张 · ${row.pct}%`}
                        highlight={i === 0}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">这一年收的图都没留下画师名字。</p>
                )}
              </CardContent>
            </Card>

            {/* 3 兴趣坐标：Top 5 标签，纸片云分档与统计页同一套 */}
            <TagCloud
              chips={narrative.topTags}
              title="兴趣坐标 · Top 5"
              description="那年出现最多的标签；越大越墨 = 出现越勤。"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 4 收藏节奏：峰值相位 + 最爱周几 */}
            <Card>
              <CardHeader>
                <CardTitle>收藏节奏</CardTitle>
                <CardDescription>那年的收藏落在什么时段、什么日子。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-x-10 gap-y-4">
                {narrative.activePhase ? (
                  <div>
                    <p className="text-xs tracking-wide text-subtle">峰值相位</p>
                    <p className="mt-1 font-display text-2xl text-fg">{narrative.activePhase}</p>
                  </div>
                ) : null}
                {narrative.topWeekday ? (
                  <div>
                    <p className="text-xs tracking-wide text-subtle">最爱周几</p>
                    <p className="mt-1 font-display text-2xl text-fg">{narrative.topWeekday}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* 5 之最：最大的一张（字节 / 页数）+ 收藏跨度；字段 null 即整半句隐藏 */}
            <Card>
              <CardHeader>
                <CardTitle>之最</CardTitle>
                <CardDescription>那一年里的「最大」与「最长」。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm leading-relaxed text-fg/90">
                {narrative.largestByBytes ? (
                  <p>
                    最大的一张（字节）是「{narrative.largestByBytes.title}」，共{" "}
                    {formatBytes(narrative.largestByBytes.bytes)}。
                  </p>
                ) : null}
                {narrative.largestByPages ? (
                  <p>
                    页数最多的是「{narrative.largestByPages.title}」，共 {narrative.largestByPages.pageCount} 页。
                  </p>
                ) : null}
                <p>
                  从 {mdOf(narrative.span.firstAt)} 到 {mdOf(narrative.span.lastAt)}，收了{" "}
                  {narrative.span.days.toLocaleString("zh-CN")} 天。
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 6 结束语：确定性推导（标签 / 画师句），读不出就不印 */}
          {narrative.closing ? (
            <p className="text-center font-display text-xl leading-relaxed tracking-tight text-fg">
              「{narrative.closing}」
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
