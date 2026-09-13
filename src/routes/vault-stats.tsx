"use client";

/**
 * 纸匣统计页（智能库）。
 *
 * 作用：分布三图（来源/画师/标签）+ 按月收藏时间线 + 存储占用（服务端聚合）
 *      + 查重状态卡。分布/时间线在客户端算（meta 全量在浏览器），占用走 API。
 * 用法：/vault/stats，入口在纸匣页头部。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/kami-link";
import { Button } from "@/components/ui/button";
import { listVault } from "@/lib/storage/vault";
import { monthOf, vaultTotals } from "@/lib/storage/vault-query";
import { formatBytes } from "@/lib/utils";
import type { VaultMeta } from "@/lib/types";

type StorageRow = { name: string; bytes: number; count: number };
type StorageResponse = { ok: boolean; bySource?: StorageRow[]; byAuthor?: StorageRow[] };
type DedupResponse = { ok: boolean; hashed?: number; total?: number; groups?: unknown[] };

function topN(counts: Map<string, number>, n: number): { name: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function BarList({ rows, unit }: { rows: { name: string; count: number }[]; unit: "条" | "GB" | "MB" }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className="text-sm text-muted">暂无数据</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.name} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate" title={row.name}>
            {row.name}
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-fg/5">
            <span className="block h-full rounded-full bg-accent/70" style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-subtle">
            {unit === "条" ? `${row.count} 条` : formatBytes(row.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VaultStatsPage() {
  const [all, setAll] = useState<VaultMeta[]>([]);
  const [storage, setStorage] = useState<StorageResponse | null>(null);
  const [dedup, setDedup] = useState<DedupResponse | null>(null);

  useEffect(() => {
    void listVault().then(setAll).catch(() => setAll([]));
    void fetch("/api/vault/stats/storage", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStorage)
      .catch(() => setStorage(null));
    void fetch("/api/vault/dedup", { cache: "no-store" })
      .then((r) => r.json())
      .then(setDedup)
      .catch(() => setDedup(null));
  }, []);

  const totals = vaultTotals(all);
  const bySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of all) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    return topN(counts, 8);
  }, [all]);
  const byAuthor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of all) {
      const name = item.author.trim() || "(未命名)";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return topN(counts, 10);
  }, [all]);
  const byTag = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of all) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return topN(counts, 10);
  }, [all]);
  const timeline = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of all) {
      const m = monthOf(item.savedAt);
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12).map(([name, count]) => ({ name, count }));
  }, [all]);

  const storageRows = (storage?.bySource ?? []).slice(0, 8).map((r) => ({ name: r.name, count: r.bytes }));
  const hashed = dedup?.hashed ?? 0;
  const total = dedup?.total ?? all.length;
  const groupCount = Array.isArray(dedup?.groups) ? dedup.groups.length : 0;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">纸匣统计</h1>
          <p className="mt-1 text-sm text-muted">
            共 {totals.count} 条 · {formatBytes(totals.bytes)}
          </p>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link to="/vault">回纸匣</Link>
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-fg/10 p-4">
          <h2 className="text-sm font-medium">来源占比</h2>
          <BarList rows={bySource} unit="条" />
        </div>
        <div className="space-y-2 rounded-lg border border-fg/10 p-4">
          <h2 className="text-sm font-medium">画师 Top 10</h2>
          <BarList rows={byAuthor} unit="条" />
        </div>
        <div className="space-y-2 rounded-lg border border-fg/10 p-4">
          <h2 className="text-sm font-medium">标签 Top 10</h2>
          <BarList rows={byTag} unit="条" />
        </div>
        <div className="space-y-2 rounded-lg border border-fg/10 p-4">
          <h2 className="text-sm font-medium">收藏时间线（近 12 个月）</h2>
          <BarList rows={timeline} unit="条" />
        </div>
        <div className="space-y-2 rounded-lg border border-fg/10 p-4">
          <h2 className="text-sm font-medium">存储占用（按来源）</h2>
          {storage?.ok ? (
            <BarList rows={storageRows} unit="MB" />
          ) : (
            <p className="text-sm text-muted">服务端统计不可用（本机只读形态正常，重试或检查服务端）。</p>
          )}
        </div>
        <div className="space-y-2 rounded-lg border border-fg/10 p-4">
          <h2 className="text-sm font-medium">查重状态</h2>
          <p className="text-sm text-muted">
            哈希覆盖 {hashed}/{total}
            {groupCount > 0 ? ` · 疑似重复 ${groupCount} 组待处理` : " · 没有待处理重复"}
          </p>
          <Button asChild size="sm" variant="secondary">
            <Link to="/vault">去处理</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
