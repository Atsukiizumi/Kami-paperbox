/**
 * 查重聚类（纸匣智能库）。
 *
 * 作用：对已存哈希做两两汉明距离（默认阈值内），≤阈值连边，并查集聚成
 *      「疑似同图不同源」组；忽略对（dismissed）的两端不连边。
 *      候选对生成走鸽笼分桶——dhash 均分 4 段各建索引，距离 < 16 位的
 *      两两必共享一段全等，只在桶内配对，几千条从 O(n²) 降到近线性；
 *      阈值 ≥ 段位数或哈希长度不整除时退回朴素全对，语义不变。
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

  // 候选对生成：鸽笼分桶——把 dhash 均分 4 段建桶（每段索引一次），海明距离
  // < 段位数的两两必共享至少一段全等，桶内配对即完备候选；阈值 ≥ 段位数或哈希
  // 长度不整除时退回朴素全对（保证语义与旧实现完全一致，只是快慢之别）。
  const CHUNKS = 4;
  const hexLen = items[0]?.dhash.length ?? 0;
  const chunkBits = (hexLen / CHUNKS) * 4;
  const useBuckets = hexLen > 0 && Number.isInteger(hexLen / CHUNKS) && threshold < chunkBits;
  const candidates: [number, number][] = [];
  if (useBuckets) {
    const seenPair = new Set<number>();
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < items.length; i++) {
      const h = items[i]!.dhash;
      const step = hexLen / CHUNKS;
      for (let c = 0; c < CHUNKS; c++) {
        const k = `${c}:${h.slice(c * step, (c + 1) * step)}`;
        const list = buckets.get(k) ?? [];
        list.push(i);
        buckets.set(k, list);
      }
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const i = Math.min(list[x]!, list[y]!);
          const j = Math.max(list[x]!, list[y]!);
          const pid = i * items.length + j;
          if (seenPair.has(pid)) continue;
          seenPair.add(pid);
          candidates.push([i, j]);
        }
      }
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) candidates.push([i, j]);
    }
  }

  for (const [i, j] of candidates) {
    const a = items[i]!;
    const b = items[j]!;
    const d = hammingHex(a.dhash, b.dhash);
    if (d > threshold) continue;
    if (skip.has(pairKeyOf(a.key, b.key))) continue;
    union(a.key, b.key);
    edges.push({ a: a.key, b: b.key, d });
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
