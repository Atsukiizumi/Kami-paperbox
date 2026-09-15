/**
 * 案头未读纸叠。
 *
 * 作用：纸匣里 90 天窗内还没打开过的藏品，叠成一摞入口。
 * 用法：DeskPage 右栏挂 <DeskStack count={n} />；count 为 0 不画。
 * 为什么：未读是本机浏览态，不进智能文件夹；点进纸匣用 ?unread=1 当芯片初值。
 */
"use client";

import { Link } from "@/lib/kami-link";

export function DeskStack({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Link
      to="/vault?unread=1"
      className="block rounded-xl bg-surface p-5 shadow-[var(--shadow-paper-1)]"
    >
      <div className="relative h-24" aria-hidden>
        <div className="absolute inset-x-4 top-2 h-16 translate-y-0 rounded-lg bg-elevated" />
        <div className="absolute inset-x-4 top-2 h-16 translate-y-1 rounded-lg bg-elevated" />
        <div className="absolute inset-x-4 top-2 h-16 translate-y-2 rounded-lg bg-elevated" />
      </div>
      <p className="mt-3 text-sm">未读 {count} 张</p>
    </Link>
  );
}
