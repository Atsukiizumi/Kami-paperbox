/**
 * 案头未拆的信。
 *
 * 作用：有追踪名单才出现；文案只用上次角标，不在案头检查。
 * 用法：DeskPage 右栏挂 <DeskLetters />。整块进 /watch。
 * 为什么：检查是追踪页的事；桌上只看还剩几封、上次数过几张新作。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { useSettings } from "@/lib/store";
import { useWatchBadge } from "@/lib/watch-badge";

export function DeskLetters() {
  const watchArtists = useSettings((s) => s.watchArtists);
  const newCount = useWatchBadge((s) => s.newCount);
  const n = watchArtists.length;
  if (n === 0) return null;

  const m = newCount;
  return (
    <Link
      to="/watch"
      className="block rounded-xl bg-surface p-5 shadow-[var(--shadow-paper-1)]"
    >
      <p className="font-display text-xl tracking-tight">未拆的信</p>
      <p className={m > 0 ? "mt-2 text-sm" : "mt-2 text-sm text-muted"}>
        {m > 0 ? `${n} 封 · ${m} 张新作` : "信都拆过了"}
      </p>
    </Link>
  );
}
