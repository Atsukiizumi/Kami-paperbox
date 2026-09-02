/**
 * 折页记号。
 *
 * 作用：空态、加载哨兵、侧栏 Logo 用同一枚折角纸。
 * 用法：<PaperMark busy /> 加载时折角慢慢合上。
 */
import { cn } from "@/lib/utils";

export function PaperMark({ className, busy }: { className?: string; busy?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("kami-logo", busy && "kami-logo-busy", className)}
      aria-hidden
    >
      <path
        d="M5.5 4.5h9L19 9v11H5.5z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        className="kami-logo-fold"
        d="M14.5 4.5V9H19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
