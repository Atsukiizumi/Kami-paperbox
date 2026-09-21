/**
 * 纸匣目录查询（纯函数，不碰 IndexedDB）。
 *
 * 作用：按关键字、站点、作者过滤已保存作品；作者口径走 author-name.ts 的
 *      分组键（同 authorId / 规范化同名归一），装饰名变体不再裂开；标签
 *      口径走 vault-tag-alias.ts 的别名表（变体原文 → 规范名，标签整理）。
 * 用法：filterVaultItems(listVault() 的结果, { text, source, authorKey, tagAliases })。
 *      关键字按空白分词，每段都要命中（标题/作者/标签/id/相对路径）。
 *      author 是旧口径（raw 名精确匹配，智能库向后兼容），authorKey 是
 *      簇键（vaultAuthorOptions().key，画师下拉的选中态）。tagAliases 由
 *      调用方从设置段带进来（不随智能库存档），标签筛选 / 搜索两侧归一。
 * 为什么单独拆文件：存储层（vault.ts）依赖浏览器 IDB，查询逻辑可以在 Node 测试里跑，
 *        也避免 UI 直接拼字符串。
 */
import { applyAuthorAlias, authorKey, clusterAuthorVariants } from "../author-name.ts";
import { isBooru, isSource } from "../sites.ts";
import { isNsfwRating } from "../booru.ts";
import { isAiWork } from "../pixiv-feed.ts";
import { applyTagAlias, applyTagAliases } from "../vault-tag-alias.ts";
import type { Source, VaultMeta } from "../types.ts";

export type VaultQuery = {
  text?: string;
  source?: Source | "all";
  author?: string;
  /** 作者簇键（authorKey）：命中 = authorId 相符，或规范化名相符。 */
  authorKey?: string;
  /** 任一命中（智能库）。 */
  tags?: string[];
  /** "YYYY-MM"，按 savedAt 本地时区（智能库）。 */
  month?: string;
  /** 标签别名表（消费时注入，不进智能库存档）：tags 筛选与文本搜索的标签段双侧归一。 */
  tagAliases?: Record<string, string>;
  /** true = 只看 AI 作画，false = 排除；undefined = 不过滤（旧藏品按 tags 词表兜底判定）。 */
  ai?: boolean;
  /** true = 只看 R-18，false = 排除；undefined = 不过滤。旧藏品无分级字段 = 未知，两端都不匹配。 */
  r18?: boolean;
};

/** 智能文件夹：命名的筛选条件组合，存设置段随账号同步。 */
export type SmartFolder = {
  id: string;
  name: string;
  query: VaultQuery;
};

export function monthOf(savedAt: number): string {
  const d = new Date(savedAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function haystackOf(item: VaultMeta, tagAliases?: Record<string, string>): string {
  return [
    item.title,
    item.author,
    item.authorId,
    item.id,
    item.source,
    item.relativePath ?? "",
    item.folderLabel ?? "",
    // 标签段过别名（去重减长度是顺带）：搜规范名「鸣潮」能命中只带「鳴潮」的藏品
    ...applyTagAliases(item.tags, tagAliases),
  ]
    .join(" ")
    .toLowerCase();
}

export function filterVaultItems(items: VaultMeta[], q: VaultQuery): VaultMeta[] {
  const text = q.text?.trim().toLowerCase();
  const tokens = text ? text.split(/\s+/).filter(Boolean) : [];
  // 双侧归一：条目侧 tags 与筛选侧 tags 各过一次单跳映射再比较——存量条件存的是
  // 变体原文（旧智能库）照常命中，新条件存规范名（tagOptions 已归一）也命中。
  const alias = q.tagAliases;
  const wantTags = q.tags?.length ? q.tags.map((t) => applyTagAlias(t, alias)) : [];
  return items.filter((item) => {
    if (q.source && q.source !== "all" && item.source !== q.source) return false;
    if (q.author && item.author !== q.author) return false;
    if (q.authorKey && authorKey(item) !== q.authorKey) return false;
    if (wantTags.length && !item.tags.some((t) => wantTags.includes(applyTagAlias(t, alias)))) return false;
    if (q.month && monthOf(item.savedAt) !== q.month) return false;
    if (q.ai !== undefined && isAiWork({ aiType: item.aiType, tags: item.tags }) !== q.ai) return false;
    if (q.r18 !== undefined && isVaultR18(item) !== q.r18) return false;
    if (tokens.length === 0) return true;
    const hay = haystackOf(item, alias);
    return tokens.every((t) => hay.includes(t));
  });
}

/** 藏品是否成人内容：pixiv/fanbox 看 xRestrict（入匣时存），booru 看 rating；
 *  旧藏品两者皆缺 = 未知 → false（R-18 笺不出、排除笺保留，如实反映未知）。 */
function isVaultR18(item: VaultMeta): boolean {
  if ((item.xRestrict ?? 0) > 0) return true;
  if (isBooru(item.source) && item.rating && isNsfwRating(item.rating, item.source)) return true;
  return false;
}

/**
 * 画师下拉选项：簇键 + 规范展示名（别名优先）+ 合并计数。
 * 选中态存 key（同一画师的装饰变体共用一个键，换名不换键）。
 */
export type AuthorOption = { key: string; name: string; count: number };

export function vaultAuthorOptions(items: VaultMeta[], aliases?: Record<string, string>): AuthorOption[] {
  return clusterAuthorVariants(items)
    .map((c) => ({ key: c.key, name: applyAuthorAlias(c.displayName, aliases), count: c.totalCount }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh") || (a.key < b.key ? -1 : 1));
}

/** 作者簇的规范展示名列表（统计口径：同 authorId / 规范化同名只算一位）。 */
export function vaultAuthors(items: VaultMeta[], aliases?: Record<string, string>): string[] {
  return vaultAuthorOptions(items, aliases).map((o) => o.name);
}

export function vaultTotals(items: VaultMeta[]): { count: number; bytes: number } {
  return {
    count: items.length,
    bytes: items.reduce((n, item) => n + (item.bytes || 0), 0),
  };
}

/**
 * 全部出现过的标签（去重、按出现次数降序，同频按字典序稳定）。
 * 带别名表时计数前归一：变体并入规范名合并计数，筛标签纸同物只剩一笺。
 */
export function vaultTags(items: readonly VaultMeta[], aliases?: Record<string, string>): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      const t = applyTagAlias(tag.trim(), aliases);
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([tag]) => tag);
}

/** 出现过的月份（去重、新的在前），供时间轴下拉。 */
export function vaultMonths(items: VaultMeta[]): string[] {
  return [...new Set(items.map((item) => monthOf(item.savedAt)))].sort().reverse();
}

/**
 * 本地 IDB 与服务端目录按 key 合并（纸匣页 refresh 的取数口径）。
 *
 * 远端为空原样返回本地（含拉取失败 undefined → 空数组的情形）；同 key 冲突
 * **本地覆盖优先**——本地 meta 编辑（批量标签等）不会被远端刷掉，只把远端的
 * hasFile（应用内像素哨兵）在本地缺失时补上。结果按 savedAt 倒序。
 * 为什么抽成纯函数：合并口径是批量标签写回的数据安全前提，用测试锁住。
 */
export function mergeVaultItems(local: VaultMeta[], remoteItems: VaultMeta[]): VaultMeta[] {
  if (remoteItems.length === 0) return local;
  const map = new Map(remoteItems.map((item) => [item.key, item]));
  for (const item of local) {
    const prev = map.get(item.key);
    map.set(item.key, {
      ...item,
      hasFile: prev?.hasFile ?? item.hasFile,
      // 客户端先行三字段远端行不携带：缺时保留本地，否则一次合并清空分级/AI 标记
      aiType: item.aiType ?? prev?.aiType,
      xRestrict: item.xRestrict ?? prev?.xRestrict,
      rating: item.rating ?? prev?.rating,
    });
  }
  return [...map.values()].sort((a, b) => b.savedAt - a.savedAt);
}

const SMART_FOLDER_LIMIT = 50;

/** 解析外部（备份/同步段）来的智能文件夹列表：逐项校验，坏项丢弃不连坐。 */
export function parseSmartFolders(raw: unknown): SmartFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: SmartFolder[] = [];
  for (const entry of raw.slice(0, SMART_FOLDER_LIMIT)) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.slice(0, 64) : "";
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 40) : "";
    const q = rec.query as Record<string, unknown>;
    if (!id || !name || !q || typeof q !== "object") continue;
    const query: VaultQuery = {};
    if (typeof q.text === "string" && q.text.trim()) query.text = q.text.slice(0, 120);
    if (typeof q.source === "string" && q.source !== "all" && isSource(q.source)) query.source = q.source as Source;
    if (typeof q.author === "string" && q.author.trim()) query.author = q.author.slice(0, 80);
    if (typeof q.authorKey === "string" && q.authorKey.trim()) query.authorKey = q.authorKey.slice(0, 120);
    if (Array.isArray(q.tags)) {
      const tags = q.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, 20);
      if (tags.length) query.tags = tags;
    }
    if (typeof q.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)) query.month = q.month;
    out.push({ id, name, query });
  }
  return out;
}
