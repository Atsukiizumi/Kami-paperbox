/**
 * 空白宣纸。
 *
 * 作用：浏览 / 纸匣 / 队列 / 历史 / 搜图共用同一张空态。
 * 用法：<EmptySheet title="还是空的" action={<Link to="/">去浏览</Link>} />
 * 为什么：各页自己写一句 + Alert，空匣看起来不像同一件东西。
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PaperMark } from "./paper-mark";

export function EmptySheet({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "kami-empty-sheet flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <PaperMark className="size-10 text-muted" />
      <p className="font-display text-xl tracking-tight text-fg">{title}</p>
      {hint ? <p className="max-w-sm text-sm leading-relaxed text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}
