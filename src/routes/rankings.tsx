/**
 * 历史热榜。
 *
 * 作用：回看图站某日/某周/某月已经记下的榜单，也可删掉不要的快照。
 * 用法：侧栏「热榜」。浏览 Yande / Konachan / Danbooru 日周月榜时会自动写入。
 * 为什么：Pixiv 自己就能按日期加载历史榜，不必再存一份。
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArtworkGrid } from "@/components/artwork-card";
import { EmptySheet } from "@/components/empty-sheet";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  clearRankings,
  deleteRanking,
  listRankings,
  loadRanking,
  type RankPeriod,
  type RankSnapshotMeta,
} from "@/lib/ranking-archive";
import { SITE_LIST, siteLabel } from "@/lib/sites";
import type { Source, WorkCard } from "@/lib/types";

export const Route = createFileRoute("/rankings")({ component: RankingsPage });

const PERIODS: { id: RankPeriod; label: string }[] = [
  { id: "daily", label: "日榜" },
  { id: "weekly", label: "周榜" },
  { id: "monthly", label: "月榜" },
];

const SITES = SITE_LIST.filter((s) => s.id !== "fanbox" && s.id !== "pixiv");

function RankingsPage() {
  const [site, setSite] = useState<Source>("yande");
  const [period, setPeriod] = useState<RankPeriod>("daily");
  const [rows, setRows] = useState<RankSnapshotMeta[]>([]);
  const [activeId, setActiveId] = useState("");
  const [items, setItems] = useState<WorkCard[]>([]);

  async function refresh() {
    const list = await listRankings(site, period);
    setRows(list);
    if (activeId && !list.some((row) => row.id === activeId)) {
      setActiveId("");
      setItems([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, [site, period]);

  async function openRow(id: string) {
    setActiveId(id);
    const snap = await loadRanking(id);
    setItems(snap?.items ?? []);
  }

  const active = useMemo(() => rows.find((row) => row.id === activeId), [rows, activeId]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">历史热榜</h1>
          <p className="mt-1 text-sm text-muted">
            Yande / Konachan / Danbooru 的日周月榜会记在这里。Pixiv 用浏览页的日期直接回看原站榜。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void clearRankings(site).then(() => refresh())}>
          清空本站
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        <ToggleGroup type="single" value={site} onValueChange={(v) => v && setSite(v as Source)}>
          {SITES.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as RankPeriod)}>
          {PERIODS.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {rows.length === 0 ? (
        <EmptySheet title="还没有记下的榜单" hint="去浏览页打开日榜、周榜或月榜，第一页会自动存进这里。" />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void openRow(row.id)}
                className={`rounded-full px-3 py-1 text-xs ${row.id === activeId ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}
              >
                {row.date} · {row.count}
              </button>
              <button
                type="button"
                className="ml-1 text-[11px] text-subtle hover:text-fg"
                onClick={() => void deleteRanking(row.id).then(() => refresh())}
              >
                删
              </button>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <section className="space-y-3">
          <h2 className="text-sm text-muted">
            {siteLabel(active.site)} {period === "daily" ? "日榜" : period === "weekly" ? "周榜" : "月榜"} · {active.date}
          </h2>
          <ArtworkGrid items={items} empty="这条快照是空的。" />
        </section>
      ) : null}

      <p className="text-xs text-subtle">
        当前榜去
        <Link to="/" className="mx-1 underline">
          浏览
        </Link>
        看。
      </p>
    </div>
  );
}
