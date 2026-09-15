"use client";

/**
 * 设置 → 存储「画师名称整理」卡片。
 *
 * 作用：把同一画师的名称变体（@handle / emoji / 装饰符，或同一 authorId 的
 *      两次改名）聚成簇，让用户挑一个规范名写进 authorAliases；已保存的
 *      别名列在下面可删，删完簇会回到待整理列表。
 * 用法：挂在存储分区 StorageSection 末尾；只读 listVault() 的元数据，不动
 *      任何已落盘的文件——别名即时作用于导出分夹、统计画像、镜像路径与
 *      纸匣筛选下拉。
 * 为什么：规范化函数只能兜住机械装饰，同一 authorId 改名 / 平↔片假名这类
 *        写法差异要人拍板；别名表随设置段同步与备份往返（backup 三处白名单），
 *        换设备不用重挑。纯静态纸面排版，无动画。
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  clusterAuthorVariants,
  clusterNeedsAlias,
  normalizeAuthorName,
  type AuthorCluster,
} from "@/lib/author-name";
import { useSettings } from "@/lib/store";
import { listVault, type VaultMeta } from "@/lib/storage/vault";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

export function AuthorTidyCard() {
  const aliases = useSettings((s) => s.authorAliases);
  const setAuthorAlias = useSettings((s) => s.setAuthorAlias);
  const removeAuthorAlias = useSettings((s) => s.removeAuthorAlias);
  const [items, setItems] = useState<VaultMeta[] | null>(null);
  /** 每簇选中的规范名（radio 的 value 是变体的规范化名）。 */
  const [picks, setPicks] = useState<Record<string, string>>({});
  /** 每簇手输的规范名（填了就优先于 radio）。 */
  const [customs, setCustoms] = useState<Record<string, string>>({});

  useEffect(() => {
    void listVault()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const clusters = useMemo(() => clusterAuthorVariants(items ?? []), [items]);
  // 已归一（各变体经规范化 + 别名后指向同一个名字）的簇不再列出
  const pending = useMemo(() => clusters.filter((c) => clusterNeedsAlias(c, aliases)), [clusters, aliases]);
  const savedEntries = useMemo(
    () => Object.entries(aliases).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [aliases],
  );

  function chosenOf(cluster: AuthorCluster): string {
    // 存变体原名（而非规范化名）：两个变体规范化后同名时，radio 才不会双双选中
    return picks[cluster.key] ?? cluster.variants[0]?.name ?? "";
  }

  function applyCluster(cluster: AuthorCluster, rawCanonical: string) {
    const canonical = rawCanonical.trim();
    if (!canonical) {
      toast.info("先挑一个名字，或输入规范名");
      return;
    }
    // 键用变体的规范化名：装饰变体归一后共用同一键，统一指向用户挑的定名
    for (const variant of cluster.variants) {
      const norm = normalizeAuthorName(variant.name);
      if (norm && norm !== canonical) setAuthorAlias(norm, canonical);
    }
    setCustoms((c) => ({ ...c, [cluster.key]: "" }));
    toast.success(`已统一为「${canonical}」`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>画师名称整理</CardTitle>
        <CardDescription>
          同一画师的不同写法（@handle、表情装饰、改名）会各建一个文件夹、统计也分开计数。
          挑一个规范名即可归一；只影响之后的导出与统计，不移动已保存的文件。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items === null ? (
          <p className="text-sm text-muted">正在清点纸匣…</p>
        ) : (
          <>
            {pending.length === 0 ? (
              <p className="text-sm text-muted">没有需要整理的画师名</p>
            ) : (
              <ul className="space-y-3">
                {pending.map((cluster) => {
                  const chosen = chosenOf(cluster);
                  return (
                    <li key={cluster.key} className="rounded-xl bg-bg p-3">
                      <p className="text-sm font-medium text-fg">
                        {cluster.displayName}
                        <span className="ml-2 text-xs text-subtle">{cluster.totalCount} 条</span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                        {cluster.variants.map((variant) => {
                          const norm = normalizeAuthorName(variant.name);
                          return (
                            <label
                              key={variant.name}
                              className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted"
                            >
                              <input
                                type="radio"
                                name={`kami-tidy-${cluster.key}`}
                                className="accent-accent"
                                checked={chosen === variant.name}
                                onChange={() => setPicks((p) => ({ ...p, [cluster.key]: variant.name }))}
                              />
                              <span className="min-w-0 break-all">
                                {variant.name}
                                {norm !== variant.name ? (
                                  <span className="text-subtle">（现：{norm}）</span>
                                ) : null}
                                <span className="ml-1 text-xs text-subtle">× {variant.count}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                          value={customs[cluster.key] ?? ""}
                          onChange={(e) => setCustoms((c) => ({ ...c, [cluster.key]: e.target.value }))}
                          placeholder="或输入规范名"
                          aria-label={`为 ${cluster.displayName} 输入规范名`}
                          className="h-9 max-w-[16rem] bg-bg text-sm"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => applyCluster(cluster, customs[cluster.key]?.trim() || normalizeAuthorName(chosen))}
                        >
                          统一
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {savedEntries.length > 0 ? (
              <div>
                <h3 className="text-sm font-medium">已保存的别名</h3>
                <ul className="mt-2 space-y-1.5">
                  {savedEntries.map(([from, to]) => (
                    <li
                      key={from}
                      className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-muted">
                        {from} <span className="text-subtle">→</span> <span className="text-fg">{to}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`删除别名 ${from}`}
                        className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:text-fg"
                        onClick={() => removeAuthorAlias(from)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
