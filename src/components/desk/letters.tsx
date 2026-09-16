/**
 * 案头未拆的信。
 *
 * 作用：有追踪名单才出现；文案只用上次角标，不在案头检查。
 * 用法：DeskPage 右栏挂 <DeskLetters />。整块进 /watch。
 * 为什么：检查是追踪页的事；桌上只看还剩几封、上次数过几张新作。
 */
"use client";

import { ProxiedImg } from "@/components/proxied-img";
import { Link } from "@/lib/kami-link";
import { useSettings } from "@/lib/store";
import { useWatchBadge } from "@/lib/watch-badge";

export function DeskLetters() {
  const watchArtists = useSettings((s) => s.watchArtists);
  const newCount = useWatchBadge((s) => s.newCount);
  const n = watchArtists.length;
  if (n === 0) return null;

  const m = newCount;
  const faces = watchArtists.slice(0, 5);
  return (
    <Link
      to="/watch"
      className="block rounded-xl bg-surface p-5 shadow-[var(--shadow-paper-1)]"
    >
      <p className="font-display text-xl tracking-tight">未拆的信</p>
      <div className="mt-3 flex -space-x-2" aria-hidden>
        {faces.map((artist) => (
          <span
            key={`${artist.source}:${artist.id}`}
            className="relative size-8 overflow-hidden rounded-full bg-elevated ring-2 ring-surface"
          >
            {artist.avatar ? (
              <ProxiedImg src={artist.avatar} alt="" className="h-full w-full object-cover" />
            ) : null}
          </span>
        ))}
      </div>
      <p className={m > 0 ? "mt-3 text-sm" : "mt-3 text-sm text-muted"}>
        {m > 0 ? `${n} 封 · ${m} 张新作` : "信都拆过了"}
      </p>
    </Link>
  );
}
