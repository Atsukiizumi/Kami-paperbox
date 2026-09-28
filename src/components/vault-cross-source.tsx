"use client";

/**
 * 同图多源视图（跨源同图簇，M1）。
 *
 * 作用：把预取好的跨源簇并排展示（簇块头 = 张数/最远距离/站点列表 + 都保留），
 *      成员复用 VaultCard（封面/题注/遮盖口径全套），卡下注释行标来源站点、
 *      体积与页数。删除成员走 onDeleteMember（vault 页 removeWork 软删链），
 *      忽略整簇按 C(n,2) 两两写既有 dismiss API。
 * 用法：<VaultCrossSource items={纸匣全量 meta} clusters={页级预取}
 *      hashed={..} total={..} tagAliases={..} onReload={刷新}
 *      onDeleteMember={removeWork} onBack={回主列表} />。
 * 为什么乐观去簇在组件内做：删除/忽略后 onReload 重拉有延迟，先按
 * 「剩余 <2 张或 distinct source <2 整簇消失」本地降级，重拉结果随后覆盖。
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { VaultCard } from "@/components/collections-bar";
import type { CrossSourceCluster } from "@/lib/storage/vault-cross-source";
import { formatBytes } from "@/lib/utils";
import { siteLabel } from "@/lib/sites";
import type { Source, VaultMeta } from "@/lib/types";

export function VaultCrossSource({
  items,
  clusters,
  hashed,
  total,
  tagAliases,
  onReload,
  onDeleteMember,
  onBack,
}: {
  items: VaultMeta[];
  clusters: CrossSourceCluster[];
  /** 哈希覆盖计数（API 的 hashed/total）：视图的诚实边界——没扫过的条目这里看不见。 */
  hashed: number;
  total: number;
  tagAliases: Record<string, string>;
  /** 忽略/删除后的统一重拉（页面 refresh 本身已含 cross-source 拉取）。 */
  onReload: () => void | Promise<void>;
  /** 删除成员走纸篓软删链（removeWork），不得直连 DELETE——IDB 副本也要忘掉。 */
  onDeleteMember: (item: VaultMeta) => void | Promise<void>;
  onBack: () => void;
}) {
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  // 乐观副本：props 重拉后同步覆盖，本地点删/忽略只活到下一次 refresh
  const [live, setLive] = useState(clusters);
  useEffect(() => setLive(clusters), [clusters]);

  function removeMemberOptimistic(key: string) {
    setLive((prev) =>
      prev
        .map((c) => {
          const keys = c.keys.filter((k) => k !== key);
          // distinct source 按当前 items 重算：少掉的成员可能正是唯一跨源桥
          const sources = new Set(keys.map((k) => byKey.get(k)?.source).filter(Boolean));
          return { ...c, keys, sources: [...sources] as string[] };
        })
        .filter((c) => c.keys.length >= 2 && c.sources.length >= 2),
    );
  }

  async function dismissCluster(cluster: CrossSourceCluster) {
    // 簇 = 组内两两 pair 的集合：整簇忽略 = 逐对写入（含同源对，共享语义不特判）
    for (let i = 0; i < cluster.keys.length; i++) {
      for (let j = i + 1; j < cluster.keys.length; j++) {
        await fetch("/api/vault/dedup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "dismiss", a: cluster.keys[i], b: cluster.keys[j] }),
        }).catch(() => undefined);
      }
    }
    setLive((prev) => prev.filter((c) => c !== cluster));
    await onReload();
  }

  return (
    <section className="space-y-4 rounded-lg border border-fg/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← 返回纸匣
        </Button>
        <h2 className="text-sm font-medium">同图多源</h2>
        <span className="text-xs tabular-nums text-subtle" data-testid="cross-coverage">
          哈希覆盖 {hashed}/{total}
          {hashed < total ? "——先去「查重」里扫描补齐" : ""}
        </span>
      </div>
      {live.length === 0 ? (
        <p className="text-sm text-muted">没有发现跨源同图。</p>
      ) : (
        <div className="space-y-4">
          {live.map((cluster) => (
            <div key={cluster.keys.join("|")} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>
                  跨源同图 · {cluster.keys.length} 张 · 最远距离 {cluster.maxDistance} ·{" "}
                  {cluster.sources.map((s) => siteLabel(s as Source)).join(" / ")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => void dismissCluster(cluster)}
                >
                  都保留（忽略）
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {cluster.keys.map((key, i) => {
                  const item = byKey.get(key);
                  if (!item) return null;
                  return (
                    <div key={key} className="space-y-1">
                      <VaultCard
                        item={item}
                        index={i}
                        tagAliases={tagAliases}
                        onDelete={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeMemberOptimistic(key);
                          void onDeleteMember(item);
                        }}
                      />
                      <p className="text-xs text-subtle" data-testid="cross-member-caption">
                        {siteLabel(item.source)} · {formatBytes(item.bytes)}
                        {item.pageCount > 1 ? ` · ${item.pageCount}P` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
