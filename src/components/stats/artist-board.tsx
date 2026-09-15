/**
 * 横条榜：心仪画师 Top 10（用户画像分区）+ 供明细区复用的 BarRow。
 *
 * 作用：纸感横条榜——名字截断带 title、条底 bg-fg/10、填充 bg-accent/70，
 *      榜首整支宣纸色；BarRow 同时被页面按月时间线 / 存储占用复用。
 * 用法：<ArtistBoard rows={[{ name, count }]} />；<BarRow name value max right />。
 * 为什么：延续旧统计页的横条语言（用户已熟），但搬进 Card 分区并统一行距，
 *        不再和其它五张同构卡挤成仪表盘。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function BarRow({
  name,
  value,
  max,
  right,
  nameClass,
  highlight,
}: {
  name: string;
  value: number;
  max: number;
  right: string;
  nameClass?: string;
  highlight?: boolean;
}) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={cn("min-w-0 shrink-0 truncate text-fg/90", nameClass ?? "w-28")} title={name}>
        {name}
      </span>
      <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
        <span
          className={cn("block h-full rounded-full", highlight ? "bg-accent" : "bg-accent/70")}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-subtle">{right}</span>
    </li>
  );
}

export function ArtistBoard({
  rows,
  className,
}: {
  rows: { name: string; count: number }[];
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>心仪画师 · Top 10</CardTitle>
        <CardDescription>收得最多的画师；榜首整条宣纸色。</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">暂无数据</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row, i) => (
              <BarRow
                key={row.name}
                name={row.name}
                value={row.count}
                max={max}
                right={`${row.count} 张`}
                highlight={i === 0}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
