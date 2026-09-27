/**
 * 手工合集：数据模型 + 解析 + 重排纯函数。
 *
 * 作用：合集随设置段同步（zustand persist v15 + 备份往返）；详情与计数用
 *      collectionMembers 做软失效过滤，重排语义锁在 moveCollectionItem 纯函数里。
 * 为什么不主动清洗失配 key：重新收藏同作品生成同 key（workKey），失配项
 *      自然恢复——解析/写入层清洗会把这份恢复能力丢掉。
 */

export const COLLECTION_LIMIT = 50; // 合计上限，同 smartFolders 的 SMART_FOLDER_LIMIT=50（vault-query.ts）
export const COLLECTION_ITEMS_LIMIT = 500; // 单合集上限，同 TAG_ALIAS_ENTRY_LIMIT=500 口径（vault-tag-alias.ts）

export type Collection = {
  id: string; // crypto.randomUUID()，创建时生成
  name: string; // trim 后 1..40 字（与 addSmartFolder 的 slice(0,40) 同口径）
  /** 显式封面 = 某个成员的 VaultMeta.key；不设则渲染期兜底 items[0]。 */
  coverKey?: string;
  /** 有序成员（workKey，`${source}:${id}` 形态），顺序即用户编排。 */
  items: string[];
  createdAt: number;
  updatedAt: number; // 每次改动（加入/移除/重排/重命名/换封面）都刷新
};

/**
 * 解析外部（备份/迁移/同步段）来的合集列表：逐项校验、坏项丢弃、id 去重取首个、
 * items 保序去重、双上限截取。items 不做 key 形态校验——软失效交给渲染期，
 * 解析层清洗会破坏「重新收藏同作品自然恢复」。
 */
export function parseCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return [];
  const out: Collection[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, COLLECTION_LIMIT)) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.slice(0, 64) : "";
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 40) : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const items: string[] = [];
    if (Array.isArray(rec.items)) {
      const seenKeys = new Set<string>();
      for (const k of rec.items) {
        if (typeof k !== "string" || !k || seenKeys.has(k)) continue;
        seenKeys.add(k);
        items.push(k);
        if (items.length >= COLLECTION_ITEMS_LIMIT) break;
      }
    }
    const parsed: Collection = {
      id,
      name,
      items,
      createdAt: Number(rec.createdAt) || 0,
      updatedAt: Number(rec.updatedAt) || 0,
    };
    if (typeof rec.coverKey === "string" && rec.coverKey) parsed.coverKey = rec.coverKey.slice(0, 120);
    out.push(parsed);
  }
  return out;
}

/** 软失效：渲染时过滤「当前纸匣里已不存在」的 key，纯函数供详情页与计数共用。 */
export function collectionMembers(collection: Collection, vaultKeys: ReadonlySet<string>): string[] {
  return collection.items.filter((k) => vaultKeys.has(k));
}

/** 重排：action ∈ "up" | "down" | "top"；越界（首项上移/末项下移/未命中）原样返回。 */
export function moveCollectionItem(items: readonly string[], key: string, action: "up" | "down" | "top"): string[] {
  const index = items.indexOf(key);
  if (index < 0) return [...items]; // 未命中：原样（新数组，不改入参）
  if (action === "top") {
    if (index === 0) return [...items];
    return [key, ...items.filter((k) => k !== key)];
  }
  const target = action === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return [...items]; // 首项上移/末项下移：no-op
  const next = [...items];
  next[index] = items[target];
  next[target] = items[index];
  return next;
}
