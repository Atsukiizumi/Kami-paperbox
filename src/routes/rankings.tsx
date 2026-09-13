/**
 * 历史热榜。
 *
 * 作用：回看图站某日/某周/某月已经记下的榜单，也可删掉不要的快照。
 * 用法：侧栏「热榜」。浏览 Yande / Konachan / Danbooru 日周月榜时会自动写入。
 * 为什么：Pixiv 自己就能按日期加载历史榜，不必再存一份。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtworkGrid } from "@/components/artwork-card";
import { EmptySheet } from "@/components/empty-sheet";
import { Button } from "@/components/ui/button";
import {
  clearRankings,
  deleteRanking,
  listRankings,
  loadRanking,
  type RankPeriod,
  type RankSnapshotMeta,
} from "@/lib/storage/ranking-archive";
import { SITE_LIST, siteLabel } from "@/lib/sites";
import type { Source, WorkCard } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERIODS: { id: RankPeriod; label: string }[] = [
  { id: "daily", label: "日榜" },
  { id: "weekly", label: "周榜" },
  { id: "monthly", label: "月榜" },
];

const SITES = SITE_LIST.filter((s) => s.id !== "fanbox" && s.id !== "pixiv");

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full px-3.5 text-sm",
        active ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function RankingsPage() {
  const [site, setSite] = useState<Source>("yande");
  const [period, setPeriod] = useState<RankPeriod>("daily");
  const [rows, setRows] = useState<RankSnapshotMeta[]>([]);
  const [activeId, setActiveId] = useState("");
  const [items, setItems] = useState<WorkCard[]>([]);

  const refreshToken = useRef(0);

  async function refresh(preferId?: string) {
    const token = ++refreshToken.current;
    const list = await listRankings(site, period);
    if (token !== refreshToken.current) return;
    setRows(list);
    const next = preferId && list.some((row) => row.id === preferId) ? preferId : list[0]?.id ?? "";
    setActiveId(next);
    if (!next) {
      setItems([]);
      return;
    }
    const snap = await loadRanking(next);
    setItems(snap?.items ?? []);
  }

  useEffect(() => {
    // TD-16：site/period 快速切换时，旧列表回来不得覆盖新选择
    const token = ++refreshToken.current;
    void refresh().finally(() => {
      if (token !== refreshToken.current) return;
    });
  }, [site, period]);

  async function openRow(id: string) {
    setActiveId(id);
    const token = ++refreshToken.current;
    const snap = await loadRanking(id);
    if (token !== refreshToken.current) return;
    setItems(snap?.items ?? []);
  }

  const active = useMemo(() => rows.find((row) => row.id === activeId), [rows, activeId]);
  const periodLabel = PERIODS.find((item) => item.id === period)?.label ?? period;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">历史热榜</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            记下图站已经打开过的日榜、周榜、月榜。Pixiv 请在浏览页改日期。
          </p>
        </div>
        {rows.length > 0 ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void clearRankings(site).then(() => refresh())}>
            清空本站
          </Button>
        ) : null}
      </header>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-10 shrink-0 text-xs text-subtle">站点</span>
          {SITES.map((item) => (
            <Chip key={item.id} active={site === item.id} onClick={() => setSite(item.id)}>
              {item.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-10 shrink-0 text-xs text-subtle">榜单</span>
          {PERIODS.map((item) => (
            <Chip key={item.id} active={period === item.id} onClick={() => setPeriod(item.id)}>
              {item.label}
            </Chip>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptySheet
          title="还没有记下的榜单"
          hint={`在浏览里打开 ${siteLabel(site)} 的${periodLabel}，第一页会存到这里。`}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-10 shrink-0 text-xs text-subtle">日期</span>
            {rows.map((row) => (
              <span key={row.id} className="inline-flex items-center gap-1">
                <Chip active={row.id === activeId} onClick={() => void openRow(row.id)}>
                  {`${row.date} · ${row.count}`}
                </Chip>
                <button
                  type="button"
                  className="text-xs text-subtle hover:text-fg"
                  onClick={() => void deleteRanking(row.id).then(() => refresh(activeId === row.id ? "" : activeId))}
                >
                  删
                </button>
              </span>
            ))}
          </div>
          {active ? (
            <section className="space-y-3">
              <h2 className="text-sm text-muted">
                {siteLabel(active.site)} {periodLabel} · {active.date}
              </h2>
              <ArtworkGrid items={items} empty="这条快照是空的。" />
            </section>
          ) : null}
        </div>
      )}

      <p className="text-xs text-subtle">
        <Link to="/" className="underline">
          返回浏览
        </Link>
      </p>
    </div>
  );
}
