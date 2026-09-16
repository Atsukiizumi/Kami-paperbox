/**
 * 案头未读纸叠。
 *
 * 作用：纸匣里 90 天窗内还没打开过的藏品，用真封面叠成入口——6 张扇形叠开，
 *      微微错位带点转角，保留「一摞纸」手感；比旧版三叠更满。
 * 用法：DeskPage 右栏挂 <DeskStack count={n} items={unread} />；count 为 0 不画。
 * 为什么：空色块叠纸看起来像占位；封面才是匣里的纸。
 */
"use client";

import { ProxiedImg } from "@/components/proxied-img";
import { useVaultCover } from "@/components/vault-cover";
import { Link } from "@/lib/kami-link";
import { hasVaultCover } from "@/lib/storage/vault-profile";
import { vaultPageUrl } from "@/lib/storage/vault-sync";
import type { VaultMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 六张的叠位：横向错开 + 微转角 + 上下起伏，z 递增，末张压轴。 */
const LEAF_PLACE = [
  "left-0 top-2 z-0 -rotate-2",
  "left-9 top-0 z-10 rotate-1",
  "left-[4.5rem] top-3 z-20 -rotate-1",
  "left-[7.25rem] top-1 z-30 rotate-2",
  "left-40 top-2 z-40 -rotate-1",
  "left-[12.5rem] top-0 z-50 rotate-1",
] as const;

function StackLeaf({ item, place }: { item: VaultMeta; place: string }) {
  const { thumb } = useVaultCover(item);
  const src = thumb || vaultPageUrl(item.key);
  return (
    <div
      className={cn(
        "absolute top-1 aspect-[3/4] w-24 overflow-hidden rounded-lg bg-elevated shadow-[var(--shadow-paper-2)]",
        place,
      )}
    >
      {src ? <ProxiedImg src={src} alt="" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

export function DeskStack({ count, items }: { count: number; items: VaultMeta[] }) {
  if (count === 0) return null;
  const shown = items.filter(hasVaultCover).slice(0, 6);

  return (
    <Link
      to="/vault?unread=1"
      className="block rounded-xl bg-surface p-4 shadow-[var(--shadow-paper-1)]"
    >
      <div className="relative h-40" aria-hidden>
        {shown.length === 0 ? (
          <div className="absolute inset-x-6 inset-y-2 rounded-lg bg-elevated" />
        ) : (
          shown.map((item, i) => <StackLeaf key={item.key} item={item} place={LEAF_PLACE[i] ?? "left-0"} />)
        )}
      </div>
      <p className="mt-3 font-display text-3xl tracking-tight tabular-nums">{count}</p>
      <p className="text-sm text-muted">未读</p>
    </Link>
  );
}
