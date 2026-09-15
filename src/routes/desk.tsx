/**
 * 今日案头（主页稿纸）。
 *
 * 作用：打开应用落到这里；去浏览进 /browse。
 * 用法：app/page.tsx 渲染 DeskPage。
 * 为什么：浏览是工作面，案头是坐下的那张纸。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { siteLabel } from "@/lib/sites";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

function todayLabel(now = new Date()): { title: string; date: string } {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  return { title: "今日", date };
}

export function DeskPage() {
  const tab = useSettings((s) => s.tab);
  const { title, date } = todayLabel();
  return (
    <div className="mx-0 max-w-6xl space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">{title}</h1>
        <p className="text-sm text-muted">{date}</p>
      </header>
      <Link
        to="/browse"
        prefetch={false}
        className={cn(
          "kami-card-folded relative block min-h-[17.5rem] rounded-xl bg-surface p-6 shadow-[var(--shadow-paper-1)] md:p-8",
        )}
      >
        <p className="text-xs tracking-wide text-subtle">当前 · {siteLabel(tab)}</p>
        <p className="mt-6 font-display text-4xl tracking-tight md:text-5xl">去浏览</p>
        <p className="mt-3 text-sm text-muted">日榜、关注、推荐都在那边</p>
      </Link>
    </div>
  );
}
