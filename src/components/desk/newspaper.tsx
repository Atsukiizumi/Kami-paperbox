/**
 * 案头今日报纸。
 *
 * 作用：现场拉当前站日榜竖图；失败 / 空 / FANBOX 整栏不出现。
 *      日榜有货即「贪吃蛇式」水平流动：小矩形节点首尾相连，蛇头从左向右
 *      平滑行进、后续节点依次跟随，透明度沿身体逐级降低成尾迹；蛇头行到
 *      右侧后从左侧无缝回卷（rAF 驱动 transform，纯合成层不掉帧）。蛇长随
 *      图片量伸缩（少了就短，多了封顶路径容量后按 slot 环换班——全部名次
 *      轮流当蛇头）。悬停 / 切后台 / 滚离视口暂停；prefers-reduced-motion
 *      下静止为单行静态行（溢出隐藏 + 右缘渐隐，无滚动条）。名次徽标 =
 *      节点当前承载作品的榜单名次。无手动控件。
 * 用法：DeskPage 通栏挂 <DeskNewspaper className={…} />。
 * 为什么：独立 queryKey desk-newspaper，不和保活浏览抢 home-pixiv / home-booru；
 *      整行流动比整组淡换能上场更多名次，宽度也随视口自适应。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProxiedImg, warmMedia } from "@/components/proxied-img";
import { useMediaFlag } from "@/components/desk/use-media-flag";
import { useViewportActive } from "@/components/desk/use-viewport-active";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { parseBoardDate } from "@/lib/booru";
import { snakeNodeCount, snakeOpacity } from "@/lib/desk-carousel";
import { rankingPageItems } from "@/lib/desk-newspaper";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import { fetchSource } from "@/lib/source";
import { pixivRankingDateParam, rememberRanking } from "@/lib/storage/ranking-archive";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { credentialTag } from "@/lib/sync/cred-tag";
import type { WorkCard } from "@/lib/types";
import type { CSSProperties } from "react";

/** 报纸蛇形：日榜全量上场，cap 30 防性能；节点定宽（96px）让步距/路径计算稳定。 */
const NEWSPAPER_SNAKE_CAP = 30;
const NODE_W = 96;
const NODE_GAP = 10;
const NODE_STEP = NODE_W + NODE_GAP;
const SNAKE_SPEED_PX_S = 45;

function NodeCard({ card, rank, style }: { card: WorkCard; rank: number; style?: CSSProperties }) {
  return (
    <Link
      to="/work/$source/$id"
      params={{ source: card.source, id: card.id }}
      style={style}
      className="relative block aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-lg bg-elevated shadow-[var(--shadow-paper-1)]"
    >
      <ProxiedImg src={card.thumb} alt="" className="h-full w-full object-cover" />
      <span className="absolute left-1 top-1 text-[10px] tabular-nums text-accent-fg">{rank}</span>
    </Link>
  );
}

export function DeskNewspaper({ className }: { className?: string }) {
  const tab = useSettings((s) => s.tab);
  const safeModeBySite = useSettings((s) => s.safeModeBySite);
  const safeMode = safeModeBySite[tab];
  const hideAi = useSettings((s) => s.hideAi);
  const cookie = useSettings((s) => s.pixivCookie);
  const hydrated = useSettingsHydrated();
  const dateIso = parseBoardDate().iso;

  const query = useQuery({
    queryKey: ["desk-newspaper", tab, safeMode, hideAi, credentialTag(cookie), dateIso],
    enabled: hydrated && tab !== "fanbox",
    staleTime: BROWSE_STALE_MS,
    queryFn: async () => {
      const creds = cookiesFromSettings(tab);
      if (tab === "pixiv") {
        return fetchSource({
          data: {
            op: "pixivRanking",
            mode: "daily",
            page: 1,
            date: pixivRankingDateParam(dateIso),
            ...creds,
          },
        });
      }
      if (isBooru(tab)) {
        return fetchSource({
          data: {
            op: "booruList",
            site: tab,
            feed: "daily",
            page: 1,
            date: dateIso,
            ...creds,
          },
        });
      }
      throw new Error("不应发生");
    },
  });

  // 榜单全量（cap 30）；query.data 引用稳定，track 顺势稳定。
  const trackItems = useMemo(
    () => rankingPageItems(query.data).slice(0, NEWSPAPER_SNAKE_CAP),
    [query.data],
  );

  useEffect(() => {
    const page = rankingPageItems(query.data);
    if (page.length === 0) return;
    void rememberRanking({ site: tab, period: "daily", date: dateIso, items: page });
  }, [tab, dateIso, query.data]);

  // 滚离视口 / 切后台 → 暂停；系统「减弱动态效果」→ 静止（静态分支无滚动条）。
  const { ref: viewportRef, active } = useViewportActive<HTMLElement>();
  const reduced = useMediaFlag("(prefers-reduced-motion: reduce)");
  const [hovered, setHovered] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const headRef = useRef(0);
  const [rowW, setRowW] = useState(0);
  const [slotBase, setSlotBase] = useState(0);

  // 蛇长随图片量伸缩：路径 = 容器宽 + 节点宽（蛇头出右入左的环长）。
  const path = rowW + NODE_W;
  const nodeCount = snakeNodeCount(trackItems.length, path, NODE_STEP);
  const animated = !reduced && nodeCount >= 2;

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setRowW(el.clientWidth));
    ro.observe(el);
    setRowW(el.clientWidth);
    return () => ro.disconnect();
    // 挂载时数据多半还在路上（骨架屏分支没有 rowRef），数据到位后行真正
    // 渲染出来才测得到宽——依赖 trackItems 数量而不是 []。
  }, [trackItems.length]);

  // 渲染即整环预热（warmThumbs 自带去重）——流动行进没有「下一帧」概念。
  useEffect(() => {
    for (const card of trackItems) warmMedia(card.thumb);
  }, [trackItems]);

  // rAF 蛇头推进：只写 transform（合成层），暂停即冻结（不追赶）；蛇头回卷时
  // slot 环进位——后续名次顶上蛇头，全部图片轮流在场。
  useEffect(() => {
    if (!animated) return;
    let raf = 0;
    let last = performance.now();
    const paused = !active || hovered;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!paused) {
        headRef.current += SNAKE_SPEED_PX_S * dt;
        if (headRef.current >= path) {
          headRef.current -= path;
          setSlotBase((b) => (b + 1) % Math.max(trackItems.length, 1));
        }
      }
      for (let s = 0; s < nodeCount; s++) {
        const el = nodeRefs.current[s];
        if (!el) continue;
        const x = (((headRef.current - s * NODE_STEP) % path) + path) % path - NODE_W;
        el.style.transform = `translateX(${x}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, path, nodeCount, active, hovered, trackItems.length]);

  if (tab === "fanbox") return null;

  if (query.isPending) {
    return (
      <section className={className}>
        <p className="text-sm text-muted">今日报纸</p>
        <div className="mt-3 flex gap-2.5 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-[3/4] w-24 shrink-0 rounded-lg bg-surface" />
          ))}
        </div>
      </section>
    );
  }

  if (query.isError || trackItems.length === 0) return null;

  const slots = Array.from({ length: Math.max(nodeCount, 1) }, (_, s) => s);

  return (
    <section ref={viewportRef} className={className}>
      <Link to="/rankings" className="text-sm text-muted hover:text-fg">
        今日报纸 · {siteLabel(tab)} 日榜
      </Link>
      <div
        ref={rowRef}
        className="relative mt-3 h-32 overflow-hidden"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {rowW === 0 ? null : animated ? (
          slots.map((s) => {
            const idx = (slotBase + s) % trackItems.length;
            const card = trackItems[idx]!;
            return (
              <div
                key={s}
                ref={(el) => {
                  nodeRefs.current[s] = el;
                }}
                className="absolute left-0 top-0 will-change-transform"
                style={{ opacity: snakeOpacity(s, nodeCount), zIndex: nodeCount - s }}
              >
                <NodeCard card={card} rank={idx + 1} />
              </div>
            );
          })
        ) : (
          // 静态行（减弱动效 / 数据太少）：普通排布，溢出隐藏 + 右缘渐隐，无滚动条。
          <div className="flex h-full gap-2.5 overflow-hidden [mask-image:linear-gradient(to_right,black_68%,transparent_90%)]">
            {slots.map((s) => {
              const card = trackItems[s] ?? trackItems[0]!;
              return <NodeCard key={`${card.source}:${card.id}`} card={card} rank={s + 1} />;
            })}
          </div>
        )}
      </div>
    </section>
  );
}
