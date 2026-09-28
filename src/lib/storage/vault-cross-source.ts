/**
 * dhash 跨源消费面（同图多源簇 + 近邻查询）。
 *
 * 作用：crossSourceClusters 复用 clusterDupes 聚类后按「组内 distinct source ≥ 2」
 *      过滤出跨源同图簇；nearestByDhash 对全表线性扫汉明距离，返回阈值内近邻
 *      （阈值/条数/排除/同源跳过/忽略对全参数化，距离升序稳定排序）。
 * 用法：crossSourceClusters(store.list() 的 key+source 子集, store.hashes(),
 *      阈值, store.dismissedPairs())；nearestByDhash(store.hashes(), 查询 dhash, opts)。
 * 为什么单独成文件：聚类核心归同源查重（vault-dedup.ts）所有，本文件只放跨源消费面，
 *      对 clusterDupes 只调用不改造；阈值必须引用同一常量，否则同一对图会
 *      「多源簇里在、搜匣搜不到」。
 */
import { hammingHex } from "./dhash.ts";
import { DUP_HASH_THRESHOLD, clusterDupes } from "./vault-dedup.ts";

export type CrossSourceCluster = { keys: string[]; sources: string[]; maxDistance: number };

export function crossSourceClusters(
  items: { key: string; source: string }[],
  hashes: { key: string; dhash: string }[],
  threshold = DUP_HASH_THRESHOLD,
  dismissed: string[] = [],
): CrossSourceCluster[] {
  // join：key→source 建 Map；items 外的哈希行（软删残留等脏数据）丢弃
  const sourceOf = new Map(items.map((it) => [it.key, it.source]));
  const joined = hashes
    .filter((h) => sourceOf.has(h.key))
    .map((h) => ({ key: h.key, dhash: h.dhash }));
  return clusterDupes(joined, threshold, dismissed)
    .map((group) => {
      // 整形：sources distinct、按组内出现序；keys/maxDistance 原样透传
      const sources: string[] = [];
      for (const key of group.keys) {
        const source = sourceOf.get(key)!;
        if (!sources.includes(source)) sources.push(source);
      }
      return { ...group, sources };
    })
    .filter((group) => group.sources.length >= 2); // 纯同源组整体丢弃，归查重管
}

/** 搜匣近邻默认 topK：不做请求参数（YAGNI），改需求时只动这里。 */
export const SEARCH_BY_IMAGE_TOP_K = 8;

export function nearestByDhash(
  hashes: { key: string; dhash: string }[],
  dhash: string,
  opts: {
    threshold?: number;
    limit?: number;
    excludeKeys?: ReadonlySet<string>;
    sourceOf?: (key: string) => string;
    skipSameSourceAs?: string;
    dismissed?: string[];
  } = {},
): { key: string; distance: number }[] {
  const threshold = opts.threshold ?? DUP_HASH_THRESHOLD;
  const limit = opts.limit ?? SEARCH_BY_IMAGE_TOP_K;
  const excludeKeys = opts.excludeKeys;
  // sourceOf 缺省按 vault key 的 `${source}:${id}` 前缀约定——与 store.put 入库时
  // parseVaultKey 解出的前缀同口径；skipSameSourceAs 与 sourceOf 联动才生效
  const sourceOf = opts.sourceOf ?? ((key: string) => key.split(":")[0]);
  const skipSource = opts.skipSameSourceAs;
  // 查询方只带 dhash 不带 key，忽略对按端点近似：条目出现在任一忽略对即跳过。
  // 比逐对精确判定多滤的场景（忽略对与查询条目无关）只损失一条提示，提示面宁缺勿滥
  const dismissedEnds = new Set((opts.dismissed ?? []).flatMap((pair) => pair.split("|")));

  const hits: { key: string; distance: number }[] = [];
  for (const h of hashes) {
    if (excludeKeys?.has(h.key)) continue;
    if (skipSource !== undefined && sourceOf(h.key) === skipSource) continue;
    if (dismissedEnds.has(h.key)) continue;
    const distance = hammingHex(h.dhash, dhash);
    if (distance > threshold) continue;
    hits.push({ key: h.key, distance });
  }
  // 距离升序、同距离按 key 升序——排序结果与遍历顺序无关（确定性）
  hits.sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return hits.slice(0, limit);
}
