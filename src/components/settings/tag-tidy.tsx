"use client";

/**
 * 设置 → 存储「标签整理」卡片。
 *
 * 作用：同一事物在纸匣里裂成多个标签变体（鳴潮 / 鸣潮 / WutheringWaves…）时，
 *      机械变体（大小写 / 全半角 / 空白）自动聚成待整理簇，繁简 / 跨语言
 *      变体靠手动归并框搜出来勾成一组；挑一个规范写法写进 tagAliases
 *      （变体原文 → 规范名），已保存的别名列在下面可删，删完变体回到待整理。
 * 用法：挂在存储分区 StorageSection（author-tidy 之后）；只读 listVault() 的
 *      元数据，不动任何已落盘的文件——别名即时作用于纸匣筛选 / 搜索 / 卡片
 *      展示与统计词云。items 可外部直给（组件测试注入），缺省自己清点 IDB。
 * 为什么：与画师整理同款骨架（簇 / 挑规范 / 已存列表），差别在聚类键——标签
 *        没有可依赖的规范化函数，机械变体兜底之外要人拍板；别名表随设置段
 *        同步与备份往返（backup 三处白名单），换设备不用重挑。纯静态纸面
 *        排版，无动画。
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { clusterNeedsAlias, clusterTagVariants, type TagCluster } from "@/lib/vault-tag-alias";
import { useSettings } from "@/lib/store";
import { tagCloud } from "@/lib/storage/vault-profile";
import { listVault, type VaultMeta } from "@/lib/storage/vault";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

/** 手动归并搜索结果最多摆的行数（纸面就一屏，翻找靠搜索词收窄）。 */
const MERGE_MATCH_LIMIT = 8;

export function TagTidyCard({ items: itemsProp }: { items?: VaultMeta[] }) {
  const aliases = useSettings((s) => s.tagAliases);
  const setTagAliasCluster = useSettings((s) => s.setTagAliasCluster);
  const removeTagAlias = useSettings((s) => s.removeTagAlias);
  const [loaded, setLoaded] = useState<VaultMeta[] | null>(null);
  /** 每簇 radio 选中的规范写法（值是变体原文）。 */
  const [picks, setPicks] = useState<Record<string, string>>({});
  /** 每簇手输的规范写法（填了就优先于 radio）。 */
  const [customs, setCustoms] = useState<Record<string, string>>({});
  /** 手动归并：搜索词 / 勾选的标签原文 / 手输规范名（不填用第一个勾选）。 */
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergePicked, setMergePicked] = useState<string[]>([]);
  const [mergeCustom, setMergeCustom] = useState("");

  useEffect(() => {
    // 外部直给（组件测试注入）时不读 IDB
    if (itemsProp !== undefined) return;
    void listVault()
      .then(setLoaded)
      .catch(() => setLoaded([]));
  }, [itemsProp]);

  const items = itemsProp ?? loaded;
  const clusters = useMemo(() => clusterTagVariants(items ?? []), [items]);
  // 已归一（各变体经别名后指向同一个规范名）的簇不再列出
  const pending = useMemo(() => clusters.filter((c) => clusterNeedsAlias(c, aliases)), [clusters, aliases]);
  const savedEntries = useMemo(
    () => Object.entries(aliases).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [aliases],
  );
  // 手动归并的搜索池：全部标签 + 计数（复用 tagCloud 的聚合口径）。原文口径——
  // 勾进去的字符串就是别名表的键（变体原文），不能先归一。
  const pool = useMemo(
    () => (items ? tagCloud(items, { limit: Number.POSITIVE_INFINITY }) : []),
    [items],
  );
  const mergeMatches = useMemo(() => {
    const q = mergeQuery.trim().toLowerCase();
    // 已勾选的固定排前面：换搜索词不丢勾选，删改簇不用来回搜
    const picked = mergePicked
      .map((tag) => pool.find((c) => c.tag === tag))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    const rest = (q ? pool.filter((c) => c.tag.toLowerCase().includes(q)) : pool).filter(
      (c) => !mergePicked.includes(c.tag),
    );
    return [...picked, ...rest].slice(0, Math.max(MERGE_MATCH_LIMIT, picked.length));
  }, [pool, mergeQuery, mergePicked]);
  const mergeCanonical = mergeCustom.trim() || mergePicked[0] || "";

  function chosenOf(cluster: TagCluster): string {
    // 存变体原文而非聚类键：radio 的选中态按用户看到的写法来
    return picks[cluster.key] ?? cluster.variants[0]?.name ?? "";
  }

  function applyCluster(cluster: TagCluster, rawCanonical: string) {
    const canonical = rawCanonical.trim();
    if (!canonical) {
      toast.info("先挑一个写法，或输入规范名");
      return;
    }
    setTagAliasCluster(cluster.variants.map((v) => v.name), canonical);
    setCustoms((c) => ({ ...c, [cluster.key]: "" }));
    toast.success(`已统一为「${canonical}」`);
  }

  function applyMerge() {
    if (mergePicked.length === 0 || !mergeCanonical) {
      toast.info("先勾选标签，再挑规范写法");
      return;
    }
    // 规范名取自勾选（默认第一个）时至少两个名字才成「簇」；手输规范名则勾一个也行（改名也归一）
    if (mergePicked.length < 2 && !mergeCustom.trim()) {
      toast.info("归并至少要两个名字：再勾一个，或输入规范名");
      return;
    }
    setTagAliasCluster(mergePicked, mergeCanonical);
    setMergePicked([]);
    setMergeCustom("");
    setMergeQuery("");
    toast.success(`已统一为「${mergeCanonical}」`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>标签整理</CardTitle>
        <CardDescription>
          同一事物的不同写法（鳴潮 / 鸣潮 / WutheringWaves）会在筛选纸里各占一笺、统计分开计数。
          大小写 / 全半角这类机械变体会自动聚簇；繁简、中英这类搜出来手动归并。
          只影响筛选、搜索与统计展示，不改已保存的标签原文。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items === null ? (
          <p className="text-sm text-muted">正在清点纸匣…</p>
        ) : (
          <>
            {pending.length === 0 ? (
              <p className="text-sm text-muted">没有需要整理的标签</p>
            ) : (
              <ul className="space-y-3">
                {pending.map((cluster) => {
                  const chosen = chosenOf(cluster);
                  const label = cluster.variants[0]?.name ?? cluster.key;
                  return (
                    <li key={cluster.key} className="rounded-xl bg-bg p-3">
                      <p className="text-sm font-medium text-fg">
                        {label}
                        <span className="ml-2 text-xs text-subtle">{cluster.totalCount} 条</span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                        {cluster.variants.map((variant) => (
                          <label
                            key={variant.name}
                            className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted"
                          >
                            <input
                              type="radio"
                              name={`kami-tag-tidy-${cluster.key}`}
                              className="accent-accent"
                              checked={chosen === variant.name}
                              onChange={() => setPicks((p) => ({ ...p, [cluster.key]: variant.name }))}
                            />
                            <span className="min-w-0 break-all">
                              {variant.name}
                              <span className="ml-1 text-xs text-subtle">× {variant.count}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                          value={customs[cluster.key] ?? ""}
                          onChange={(e) => setCustoms((c) => ({ ...c, [cluster.key]: e.target.value }))}
                          placeholder="或输入规范名"
                          aria-label={`为 ${label} 输入规范名`}
                          className="h-9 max-w-[16rem] bg-bg text-sm"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => applyCluster(cluster, customs[cluster.key]?.trim() || chosen)}
                        >
                          统一
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="rounded-xl bg-bg p-3">
              <p className="text-sm font-medium text-fg">手动归并</p>
              <p className="mt-0.5 text-xs text-muted">
                繁简、中英这类合不进自动簇的写法，搜出来勾成一组再归并。
              </p>
              <Input
                value={mergeQuery}
                onChange={(e) => setMergeQuery(e.target.value)}
                placeholder="搜索标签"
                aria-label="搜索标签"
                className="mt-2 h-9 bg-bg text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mergeMatches.map((c) => {
                  const picked = mergePicked.includes(c.tag);
                  return (
                    <button
                      key={c.tag}
                      type="button"
                      aria-pressed={picked}
                      className={cn(
                        "h-8 rounded-full px-2.5 text-xs transition-colors",
                        picked ? "bg-accent text-accent-fg" : "bg-surface text-muted hover:text-fg",
                      )}
                      onClick={() =>
                        setMergePicked((p) => (picked ? p.filter((t) => t !== c.tag) : [...p, c.tag]))
                      }
                    >
                      {c.tag}
                      <span className="ml-1 text-subtle">×{c.count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={mergeCustom}
                  onChange={(e) => setMergeCustom(e.target.value)}
                  placeholder="规范名（不填用第一个勾选）"
                  aria-label="手动归并的规范名"
                  className="h-9 max-w-[16rem] bg-bg text-sm"
                />
                <Button type="button" size="sm" variant="secondary" onClick={applyMerge}>
                  归并
                </Button>
              </div>
            </div>

            {savedEntries.length > 0 ? (
              <div>
                <h3 className="text-sm font-medium">已保存的标签别名</h3>
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
                        aria-label={`删除标签别名 ${from}`}
                        className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:text-fg"
                        onClick={() => removeTagAlias(from)}
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
