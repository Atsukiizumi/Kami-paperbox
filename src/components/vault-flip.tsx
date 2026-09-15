"use client";

/**
 * 随手翻一张（回顾三件套 R3）。
 *
 * 作用：纸匣页头部按钮弹出的翻牌对话框——随机翻出一张藏品的封面与题注，
 *      「再翻一张」走「翻到卡背 → 换牌 → 翻回正面」的 rotateY 过渡，
 *      「看详情」直达作品页。
 * 用法：<VaultFlipDialog items={all} aliases={authorAliases} open={open} onOpenChange={setOpen} />。
 * 为什么：翻牌池只收 hasVaultCover 判定翻得出封面的条目，牌面取图与纸匣卡片
 *        共用 useVaultCover 同一条链，翻开永远是真图；动效只用 transform 过渡
 *        （零 keyframes、走合成线程），prefers-reduced-motion 下直接换牌不翻面。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/kami-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptySheet } from "@/components/empty-sheet";
import { PaperMark } from "@/components/paper-mark";
import { ProxiedImg } from "@/components/proxied-img";
import { useVaultCover } from "@/components/vault-cover";
import { applyAuthorAlias, normalizeAuthorName } from "@/lib/author-name";
import { hasVaultCover, pickRandom } from "@/lib/storage/vault-profile";
import type { VaultMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 翻面过渡时长（ms）：与 FlipCard 的 transition-transform duration 保持同步。 */
const FLIP_MS = 500;

function formatDate(savedAt: number): string {
  const d = new Date(savedAt);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function FlipCard({ item, flipped }: { item: VaultMeta; flipped: boolean }) {
  const { thumb, width, height } = useVaultCover(item);
  const aspect = width && height ? `${width} / ${height}` : "3 / 4";
  return (
    <div className="mx-auto w-full max-w-sm [perspective:1200px]">
      <div
        style={{ aspectRatio: aspect }}
        className={cn(
          "relative w-full transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none",
          flipped && "[transform:rotateY(180deg)]",
        )}
      >
        {/* 正面：封面（与纸匣卡片同一条取图链路） */}
        <div className="absolute inset-0 overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-paper-2)] [backface-visibility:hidden]">
          <ProxiedImg src={thumb} alt={item.title} fit="cover" className="size-full" priority />
        </div>
        {/* 卡背：折页记号花纹，翻面换牌时短暂露出 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-elevated text-subtle shadow-[var(--shadow-paper-2)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <PaperMark className="size-12" />
          <p className="font-display text-sm tracking-widest">Kami 纸匣</p>
        </div>
      </div>
    </div>
  );
}

export function VaultFlipDialog({
  items,
  aliases,
  open,
  onOpenChange,
}: {
  items: VaultMeta[];
  aliases?: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pool = useMemo(() => items.filter(hasVaultCover), [items]);
  const [current, setCurrent] = useState<VaultMeta | null>(null);
  const [flipped, setFlipped] = useState(false);
  const flipTimer = useRef(0);

  // 开牌：每次打开重新抽一张；合上清空并掐掉翻牌计时器，下次进来是新的
  // （否则 500ms 翻面窗口内关窗，计时器仍会落牌，重开看到的是上一张残影）
  useEffect(() => {
    if (open) setCurrent((prev) => prev ?? pickRandom(pool));
    else {
      window.clearTimeout(flipTimer.current);
      setCurrent(null);
    }
  }, [open, pool]);

  useEffect(() => () => window.clearTimeout(flipTimer.current), []);

  /** 再抽一张并尽量避开当前这张（池里只剩一张时才允许重复）。 */
  function drawNext(): VaultMeta | null {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    let next = pickRandom(pool);
    for (let i = 0; i < 8 && next?.key === current?.key; i += 1) next = pickRandom(pool);
    if (next?.key === current?.key) next = pool.find((p) => p.key !== current?.key) ?? next;
    return next;
  }

  function handleRepick() {
    const next = drawNext();
    if (!next || next.key === current?.key) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCurrent(next);
      return;
    }
    // 翻到卡背（transform 过渡）→ 背面换牌 → 翻回正面；计时器兜底，不赌 transitionend
    window.clearTimeout(flipTimer.current);
    setFlipped(true);
    flipTimer.current = window.setTimeout(() => {
      setCurrent(next);
      setFlipped(false);
    }, FLIP_MS);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,26rem)]">
        <DialogTitle>随手翻一张</DialogTitle>
        <DialogDescription>从纸匣里随机翻一张出来看看。</DialogDescription>
        {current ? (
          <div className="mt-3 space-y-4">
            <FlipCard item={current} flipped={flipped} />
            <div className="min-w-0 space-y-1 text-center">
              <p className="truncate font-medium text-fg" title={current.title}>
                {current.title}
              </p>
              <p className="text-sm text-muted">
                {applyAuthorAlias(normalizeAuthorName(current.author), aliases) || "(未命名)"} ·{" "}
                {formatDate(current.savedAt)} 收
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={handleRepick} disabled={flipped || pool.length < 2}>
                再翻一张
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link to="/work/$source/$id" params={{ source: current.source, id: current.id }}>
                  看详情
                </Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
            </div>
          </div>
        ) : (
          <EmptySheet title="没有翻得出封面的藏品" hint="先去收几张图，这里就能翻。" className="py-10" />
        )}
      </DialogContent>
    </Dialog>
  );
}
