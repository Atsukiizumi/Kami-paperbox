/**
 * 收藏节奏钟（用户画像分区）。
 *
 * 作用：按小时（24 细柱）与按周几（7 粗柱）两幅纯 CSS 柱图 + 一句画像语
 *      （「最常在深夜收图 · 周日最活跃」），峰值柱宣纸色点亮。
 * 用法：<RhythmClock hours={hourHistogram(items)} weekdays={weekdayHistogram(items)} />。
 * 为什么：节奏是画像的入口；不引图表库，24 根柱 flex 均分（min-w-0），
 *        390px 也不横向溢出；悬停 title 给出「几点 · 几张」的精确读数。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hourPhaseName, peakBucket, weekdayName } from "@/lib/storage/vault-profile";
import { cn } from "@/lib/utils";

export function RhythmClock({
  hours,
  weekdays,
  className,
}: {
  hours: number[];
  weekdays: number[];
  className?: string;
}) {
  const peakHour = peakBucket(hours);
  const peakDay = peakBucket(weekdays);
  const hourMax = Math.max(1, ...hours);
  const dayMax = Math.max(1, ...weekdays);
  const sentence =
    peakHour && peakDay
      ? `最常在${hourPhaseName(peakHour.index)}收图 · ${weekdayName(peakDay.index)}最活跃`
      : "暂无节奏数据";

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>收藏节奏</CardTitle>
        <CardDescription>{sentence}。亮的柱是峰值。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="mb-1.5 text-xs text-subtle">按小时（本地钟点）</p>
          <div
            className="flex h-24 items-end gap-[2px]"
            role="img"
            aria-label={`按小时收藏分布，峰值在 ${peakHour ? `${peakHour.index} 点` : "无"}`}
          >
            {hours.map((n, h) => (
              <span key={h} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${h} 点 · ${n} 张`}>
                <span
                  className={cn("block rounded-[2px]", peakHour?.index === h ? "bg-accent" : "bg-fg/25")}
                  style={{ height: `${n > 0 ? Math.max(6, (n / hourMax) * 100) : 3}%` }}
                />
              </span>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted" aria-hidden>
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-subtle">按周几</p>
          <div className="flex items-end gap-1.5" role="img" aria-label="按周几收藏分布">
            {weekdays.map((n, d) => (
              <div key={d} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="flex h-16 w-full items-end" title={`${weekdayName(d)} · ${n} 张`}>
                  <span
                    className={cn("block w-full rounded-[2px]", peakDay?.index === d ? "bg-accent" : "bg-fg/25")}
                    style={{ height: `${n > 0 ? Math.max(8, (n / dayMax) * 100) : 3}%` }}
                  />
                </span>
                <span className={cn("text-[10px]", peakDay?.index === d ? "text-fg" : "text-subtle")}>
                  {weekdayName(d).slice(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
