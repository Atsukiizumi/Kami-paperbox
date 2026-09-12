/**
 * 查重聚类（纸匣智能库）。
 *
 * 作用：对已存哈希做 O(n²) 两两汉明距离，≤阈值连边，并查集聚成
 *      「疑似同图不同源」组；忽略对（dismissed）的两端不连边。
 * 用法：clusterDupes(store.hashes(), threshold, store.dismissedPairs())。
 * 为什么不落库结果：几千条的重算是毫秒级，忽略/删除后重算天然即时生效。
 */
import { hammingHex } from "./dhash.ts";

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export type DupGroup = { keys: string[]; maxDistance: number };

export function clusterDupes(
  items: { key: string; dhash: string }[],
  threshold = 10,
  dismissed: string[] = [],
): DupGroup[] {
  const skip = new Set(dismissed);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  };
  const edges: { a: string; b: string; d: number }[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const d = hammingHex(a.dhash, b.dhash);
      if (d > threshold) continue;
      if (skip.has(pairKeyOf(a.key, b.key))) continue;
      union(a.key, b.key);
      edges.push({ a: a.key, b: b.key, d });
    }
  }

  const groups = new Map<string, string[]>();
  for (const item of items) {
    if (!parent.has(item.key)) continue; // 无任何近邻
    const root = find(item.key);
    const list = groups.get(root) ?? [];
    list.push(item.key);
    groups.set(root, list);
  }
  return [...groups.entries()]
    .filter(([, keys]) => keys.length >= 2)
    .map(([root, keys]) => ({
      keys,
      // union 过程根会换，组内最大距离从边表按最终根重算
      maxDistance: edges.reduce(
        (max, e) => (find(e.a) === root ? Math.max(max, e.d) : max),
        0,
      ),
    }));
}
