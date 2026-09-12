/**
 * 纸匣目录查询（纯函数，不碰 IndexedDB）。
 *
 * 作用：按关键字、站点、作者过滤已保存作品。
 * 用法：filterVaultItems(listVault() 的结果, { text, source, author })。
 *      关键字按空白分词，每段都要命中（标题/作者/标签/id/相对路径）。
 * 为什么单独拆文件：存储层（vault.ts）依赖浏览器 IDB，查询逻辑可以在 Node 测试里跑，
 *        也避免 UI 直接拼字符串。
 */
import type { Source, VaultMeta } from "./types.ts";

export type VaultQuery = {
  text?: string;
  source?: Source | "all";
  author?: string;
  /** 任一命中（智能库）。 */
  tags?: string[];
  /** "YYYY-MM"，按 savedAt 本地时区（智能库）。 */
  month?: string;
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

export function haystackOf(item: VaultMeta): string {
  return [
    item.title,
    item.author,
    item.authorId,
    item.id,
    item.source,
    item.relativePath ?? "",
    item.folderLabel ?? "",
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();
}

export function filterVaultItems(items: VaultMeta[], q: VaultQuery): VaultMeta[] {
  const text = q.text?.trim().toLowerCase();
  const tokens = text ? text.split(/\s+/).filter(Boolean) : [];
  return items.filter((item) => {
    if (q.source && q.source !== "all" && item.source !== q.source) return false;
    if (q.author && item.author !== q.author) return false;
    if (q.tags?.length && !item.tags.some((t) => q.tags!.includes(t))) return false;
    if (q.month && monthOf(item.savedAt) !== q.month) return false;
    if (tokens.length === 0) return true;
    const hay = haystackOf(item);
    return tokens.every((t) => hay.includes(t));
  });
}

export function vaultAuthors(items: VaultMeta[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    const name = item.author.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, "zh"));
}

export function vaultTotals(items: VaultMeta[]): { count: number; bytes: number } {
  return {
    count: items.length,
    bytes: items.reduce((n, item) => n + (item.bytes || 0), 0),
  };
}

/** 全部出现过的标签（去重、按出现次数降序，同频按字典序稳定）。 */
export function vaultTags(items: VaultMeta[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      const t = tag.trim();
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
    if (typeof q.source === "string" && q.source !== "all") query.source = q.source as Source;
    if (typeof q.author === "string" && q.author.trim()) query.author = q.author.slice(0, 80);
    if (Array.isArray(q.tags)) {
      const tags = q.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, 20);
      if (tags.length) query.tags = tags;
    }
    if (typeof q.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)) query.month = q.month;
    out.push({ id, name, query });
  }
  return out;
}
