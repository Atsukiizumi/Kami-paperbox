/**
 * 兴趣标签纸片云（用户画像分区，词云 lite）。
 *
 * 作用：Top 标签按频次分 5 档（vault-profile tagScale，对数分档）定字号与墨深，
 *      纸片 chips 纯 CSS 排布。
 * 用法：<TagCloud chips={tagCloud(items, { limit: 40 })} />。
 * 为什么：BarList 只能表达「名次」，云的字号/墨深能一眼读出「偏好集中度」；
 *        长标签 truncate + title，chips 只用既有 token，不写新动画。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TagChip } from "@/lib/storage/vault-profile";
import { cn } from "@/lib/utils";

/** 档位 → 字号 / 墨深：1 最淡最小（text-subtle），5 最大最实（text-fg）。 */
const SCALE_CLASS: Record<TagChip["scale"], string> = {
  1: "text-xs text-subtle",
  2: "text-sm text-muted",
  3: "text-base text-fg/75",
  4: "text-lg text-fg",
  5: "text-xl font-medium text-fg",
};

export function TagCloud({ chips, className }: { chips: TagChip[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>兴趣标签</CardTitle>
        <CardDescription>越大越墨 = 收得越勤；悬停可看张数。</CardDescription>
      </CardHeader>
      <CardContent>
        {chips.length === 0 ? (
          <p className="text-sm text-muted">暂无数据</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
            {chips.map((chip) => (
              <span
                key={chip.tag}
                title={`${chip.tag} · ${chip.count} 张`}
                className={cn(
                  "inline-block max-w-full truncate rounded-full border border-fg/10 px-2.5 py-0.5 leading-relaxed transition-colors hover:border-fg/30",
                  SCALE_CLASS[chip.scale],
                )}
              >
                {chip.tag}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
