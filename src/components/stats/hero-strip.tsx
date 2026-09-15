"use client";

/**
 * 统计页 hero 数字带（版式第一层）。
 *
 * 作用：藏品 / 画师 / 标签 / 累计字节四个大数，count-up 滚入（use-count-up #134）。
 * 用法：<HeroStrip count={n} authors={n} tags={n} bytes={n} />，数字 font-display。
 * 为什么：四个数是全页的「门面」，直接坐在书案上（不进 Card），和下面两层的
 *        纸卡分区拉开层级；小标签 text-subtle，数字 tabular-nums 防抖动。
 */
import { useCountUp } from "@/lib/use-count-up";
import { cn, formatBytes } from "@/lib/utils";

export function HeroStrip({
  count,
  authors,
  tags,
  bytes,
  className,
}: {
  count: number;
  authors: number;
  tags: number;
  bytes: number;
  className?: string;
}) {
  const countN = useCountUp(count);
  const authorsN = useCountUp(authors);
  const tagsN = useCountUp(tags);
  const bytesN = useCountUp(bytes);
  const cells = [
    { label: "藏品", value: Math.round(countN).toLocaleString("zh-CN") },
    { label: "画师", value: Math.round(authorsN).toLocaleString("zh-CN") },
    { label: "标签", value: Math.round(tagsN).toLocaleString("zh-CN") },
    { label: "累计字节", value: formatBytes(Math.round(bytesN)) },
  ];

  return (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4", className)}>
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <dt className="text-xs tracking-wide text-subtle">{cell.label}</dt>
          <dd className="mt-1 truncate font-display text-3xl tracking-tight tabular-nums text-fg md:text-4xl" title={cell.value}>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
