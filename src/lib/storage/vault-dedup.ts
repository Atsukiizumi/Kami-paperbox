/**
 * 查重聚类（纸匣智能库）。
 *
 * 作用：对已存哈希做两两汉明距离（默认阈值内），≤阈值连边，并查集聚成
 *      「疑似同图不同源」组；忽略对（dismissed）的两端不连边。
 *      候选对生成走鸽笼分桶——dhash 均分 4 段。距离 ≤ 阈值时，至少有一段的
 *      汉明距离 ≤ ⌊阈值/4⌋（阈值 10 时是 2）。桶按整段全等建，再探这段的近邻。
 *      只认全等段会漏掉「四段都有一点差别」、距离却在 4–10 的一对。
 *      哈希长度不能均分、或探查半径盖满整段时，退回朴素全对。
 * 用法：clusterDupes(store.hashes(), threshold, store.dismissedPairs())，阈值传共享
 *      常量 DUP_HASH_THRESHOLD（跨源视图/以图搜匣/收重提示同口径引用）。
 * 为什么不落库结果：几千条的重算是毫秒级，忽略/删除后重算天然即时生效。
 */
import { hammingHex } from "./dhash.ts";

/**
 * 同图判定的共享阈值：三个消费面必须同口径，否则同一对图会
 * 「多源簇里在、搜匣搜不到」的自相矛盾（design.md Q2 定案）。
 */
export const DUP_HASH_THRESHOLD = 10;

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** 段内汉明距离 ≤ radius 的全部异或掩码（含 0 = 整段相同）。 */
function masksWithin(bits: number, radius: number): number[] {
  const masks = [0];
  const choose = (start: number, left: number, mask: number) => {
    if (left === 0) {
      masks.push(mask);
      return;
    }
    for (let b = start; b <= bits - left; b++) choose(b + 1, left - 1, mask | (1 << b));
  };
  for (let r = 1; r <= radius; r++) choose(0, r, 0);
  return masks;
}

export type DupGroup = { keys: string[]; maxDistance: number };

export function clusterDupes(
  items: { key: string; dhash: string }[],
  threshold = DUP_HASH_THRESHOLD,
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

  // 候选对：鸽笼。均分 4 段后，距离 ≤ 阈值的一对至少有一段差 ≤ ⌊阈值/4⌋ 位。
  // 只收整段全等会漏掉四段都有差异的近邻（阈值 10 时这段差 1 或 2 位）。
  // 长度不能均分，或要探的半径已经盖满整段（分桶退化成全对）时走朴素全对。
  const CHUNKS = 4;
  const hexLen = items[0]?.dhash.length ?? 0;
  const step = hexLen / CHUNKS;
  const chunkBits = step * 4;
  const radius = Math.floor(threshold / CHUNKS);
  const useBuckets =
    items.length > 1 &&
    Number.isInteger(step) &&
    step > 0 &&
    radius < chunkBits &&
    threshold < chunkBits * CHUNKS;
  const candidates: [number, number][] = [];
  if (useBuckets) {
    const seenPair = new Set<number>();
    const masks = masksWithin(chunkBits, radius);
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < items.length; i++) {
      const h = items[i]!.dhash;
      for (let c = 0; c < CHUNKS; c++) {
        const k = `${c}:${h.slice(c * step, (c + 1) * step)}`;
        const list = buckets.get(k);
        if (list) list.push(i);
        else buckets.set(k, [i]);
      }
    }
    for (let i = 0; i < items.length; i++) {
      const h = items[i]!.dhash;
      for (let c = 0; c < CHUNKS; c++) {
        const chunk = h.slice(c * step, (c + 1) * step);
        const value = parseInt(chunk, 16);
        for (const mask of masks) {
          const list = buckets.get(`${c}:${(value ^ mask).toString(16).padStart(step, "0")}`);
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            const pid = i * items.length + j;
            if (seenPair.has(pid)) continue;
            seenPair.add(pid);
            candidates.push([i, j]);
          }
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
