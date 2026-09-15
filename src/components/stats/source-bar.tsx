/**
 * 来源构成堆叠条（用户画像分区）。
 *
 * 作用：一条 h-3 圆角堆叠比例条 + 图例（点名 · 张数 · 百分比），替代旧 BarList。
 * 用法：<SourceBar rows={sourceComposition(items)} />。
 * 为什么：构成关系用一条纸带读得最快；分段只用 fg 的透明度阶梯 + 峰值宣纸色，
 *        pct 由纯函数保证合计 100（四舍五入不丢 1%）。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SourceSlice } from "@/lib/storage/vault-profile";
import { cn } from "@/lib/utils";

/** 分段墨阶：榜首宣纸色，其余按名次渐淡（超出 5 个来源都归最淡档）。 */
const SEGMENT_CLASS = ["bg-accent", "bg-fg/60", "bg-fg/40", "bg-fg/25", "bg-fg/15"];

function segmentClass(rank: number): string {
  return SEGMENT_CLASS[Math.min(rank, SEGMENT_CLASS.length - 1)];
}

export function SourceBar({ rows, className }: { rows: SourceSlice[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>来源构成</CardTitle>
        <CardDescription>藏品从哪些图站收来。</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">暂无数据</p>
        ) : (
          <>
            <div
              className="flex h-3 overflow-hidden rounded-full bg-fg/10"
              role="img"
              aria-label={rows.map((row) => `${row.source} ${row.pct}%`).join("，")}
            >
              {rows.map((row, i) => (
                <span
                  key={row.source}
                  className={cn("block h-full", segmentClass(i))}
                  style={{ width: `${row.pct}%` }}
                  title={`${row.source} · ${row.count} 张 · ${row.pct}%`}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {rows.map((row, i) => (
                <li key={row.source} className="flex items-baseline gap-1.5 text-sm">
                  <span className={cn("size-2 shrink-0 self-center rounded-full", segmentClass(i))} aria-hidden />
                  <span className="truncate text-fg/90" title={row.source}>
                    {row.source}
                  </span>
                  <span className="text-xs tabular-nums text-subtle">
                    {row.count} 张 · {row.pct}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
