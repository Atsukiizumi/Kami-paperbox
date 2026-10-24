import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 笺签（工房批 ⑥ P2 的静态标签基座）。
 *
 * 作用：全站静态小标签统一走这里——默认纸面色，red 为朱红警示笺（R-18）。
 * 卡面浮层用法沿用 className 覆写（bg-bg/75 类半透明底衬，twMerge 后者胜出）。
 */
export function Badge({
  className,
  tone = "default",
  children,
}: {
  className?: string;
  tone?: "default" | "red";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-elevated px-2 py-0.5 text-xs font-medium tracking-wide text-muted",
        tone === "red" && "bg-tag-red text-tag-red-fg",
        className,
      )}
    >
      {children}
    </span>
  );
}
