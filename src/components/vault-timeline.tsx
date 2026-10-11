"use client";

/**
 * 回忆流视图（纸匣第三互斥视图，W）。
 *
 * 作用：纸匣按月分组的纯浏览时间轴——顶部月份 chip 行点按跳月，每月一段
 *      分隔头（YYYY 年 M 月 · N 张）+ 各自的瀑布网格；滚动时当前可视月
 *      高亮 chip。默认定位最新月：分组月份倒序，最新月天生在最顶，零代码。
 * 用法：<VaultTimeline items={纸匣全量 meta} tagAliases={..} onBack={回主列表} />；
 *      吃全量（不吃 filter/text，不过滤已读/替换），卡不传导出/删除/选择——
 *      回忆流纯浏览，编辑回主列表做。
 * 为什么：分组只吃 groupVaultByMonth 一份口径；当前月高亮用单个 IntersectionObserver
 *      （rootMargin 只留视口上 1/4，后到事件覆盖）而非滚动监听——省掉 rAF/节流
 *      与 getBoundingClientRect 数学，且与 chip 的 scrollIntoView 天然配合；
 *      观察目标依赖渐进渲染切片，+3 月新 section 挂载后重挂观察器补 observe。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptySheet } from "@/components/empty-sheet";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { MasonryBoard } from "@/components/masonry-board";
import { VaultCard } from "@/components/collections-bar";
import { groupVaultByMonth } from "@/lib/storage/vault-query";
import type { VaultMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

// 月份渐进渲染（PER-3 先例的月份版）：3 月起步，哨兵每次 +3，防止全量月份一次铺满
const MONTHS_START = 3;
const MONTHS_STEP = 3;

function monthLabel(month: string, count: number): string {
  const [y, m] = month.split("-");
  return `${y} 年 ${Number(m)} 月 · ${count} 张`;
}

export function VaultTimeline({
  items,
  tagAliases,
  onBack,
}: {
  items: VaultMeta[];
  tagAliases: Record<string, string>;
  onBack: () => void;
}) {
  const months = useMemo(() => groupVaultByMonth(items), [items]);
  const [visibleMonths, setVisibleMonths] = useState(MONTHS_START);
  const [active, setActive] = useState<string | null>(null);
  // 已渲染月份段的锚点表：chip 跳月与观察器共用（ref 卸载时摘除，items 变化不挂死引用）
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const shown = useMemo(() => months.slice(0, visibleMonths), [months, visibleMonths]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.getAttribute("data-month"));
        }
      },
      // 只留视口上 1/4：某月进入顶部带即成为当前月（后到事件覆盖）
      { rootMargin: "0px 0px -75% 0px" },
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);

  // 跳到渐进渲染尚未铺到的月份：先扩切片，等目标段挂载后补滚（trellis-check P1）
  const pendingScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    const el = sectionRefs.current.get(pendingScrollRef.current);
    if (!el) return;
    pendingScrollRef.current = null;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [shown]);

  function jumpTo(month: string) {
    // 点击立刻置 active，不等观察器回填（smooth 滚动途中事件乱序会闪）
    setActive(month);
    const idx = months.findIndex((m) => m.month === month);
    if (idx >= visibleMonths) setVisibleMonths(idx + 1);
    if (sectionRefs.current.has(month)) {
      sectionRefs.current.get(month)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      pendingScrollRef.current = month;
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-fg/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← 返回纸匣
        </Button>
        <h2 className="text-sm font-medium">回忆流</h2>
        <span className="text-xs tabular-nums text-subtle">{items.length} 张</span>
      </div>
      {months.length === 0 ? (
        <EmptySheet
          title="回忆流还是空的"
          hint="先去浏览把喜欢的作品收进纸匣，攒下几个月，这里就是你的收藏年轮。"
        />
      ) : (
        <>
          <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="按月跳转">
            {months.map((g) => (
              <button
                key={g.month}
                type="button"
                data-month-chip={g.month}
                aria-current={active === g.month ? "true" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs tabular-nums transition-colors",
                  active === g.month ? "bg-accent/20 text-accent-fg" : "bg-elevated text-muted hover:text-fg",
                )}
                onClick={() => jumpTo(g.month)}
              >
                {g.month} · {g.items.length}
              </button>
            ))}
          </nav>
          <div className="space-y-8">
            {shown.map((g) => (
              <section
                key={g.month}
                data-month={g.month}
                className="space-y-2"
                ref={(el) => {
                  if (el) sectionRefs.current.set(g.month, el);
                  else sectionRefs.current.delete(g.month);
                }}
              >
                <h3 className="text-sm font-medium text-fg">{monthLabel(g.month, g.items.length)}</h3>
                <MasonryBoard>
                  {g.items.map((item, i) => (
                    <VaultCard key={item.key} item={item} index={i} tagAliases={tagAliases} />
                  ))}
                </MasonryBoard>
              </section>
            ))}
            <InfiniteSentinel
              disabled={shown.length >= months.length}
              onVisible={() => setVisibleMonths((n) => Math.min(n + MONTHS_STEP, months.length))}
            />
          </div>
        </>
      )}
    </section>
  );
}
