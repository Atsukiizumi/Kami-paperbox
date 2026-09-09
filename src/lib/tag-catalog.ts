/**
 * 图站标签仓库。
 *
 * 作用：浏览 Yande / Konachan / Danbooru 时把见到的英文 tag 收进来，
 *      记下出现次数和来源站；译文仍走 tag-lexicon（用户 zh 覆盖内置）。
 * 用法：collectBooruTags(source, work.tags)；设置页搜 en / zh 后补译。
 * 为什么：对齐 EhTagTranslation 的「先收词再译」而不是只靠一份静态种子。
 *        不接 E 站那份库——命名空间和标签集都不一样。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Source } from "./types.ts";
import { normalizeLexiconKey } from "./tag-lexicon.ts";

export const TAG_CATALOG_MAX = 8_000;
const FLUSH_MS = 400;

export type BooruSite = "yande" | "konachan" | "danbooru";

export type TagCatalogEntry = {
  en: string;
  count: number;
  lastSeen: number;
  sites: BooruSite[];
};

type CatalogState = {
  entries: TagCatalogEntry[];
  ingest: (source: Source, tags: readonly string[]) => void;
  ingestMany: (items: ReadonlyArray<{ source: Source; tags?: readonly string[] }>) => void;
};

function isBooruSite(source: Source): source is BooruSite {
  return source === "yande" || source === "konachan" || source === "danbooru";
}

export function splitBooruTokens(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    for (const part of raw.split(/\s+/)) {
      const en = normalizeLexiconKey(part);
      if (!en || seen.has(en)) continue;
      seen.add(en);
      out.push(en);
    }
  }
  return out;
}

export function mergeCatalog(
  current: readonly TagCatalogEntry[],
  source: Source,
  tags: readonly string[],
  at = Date.now(),
): TagCatalogEntry[] {
  if (!isBooruSite(source)) return [...current];
  const tokens = splitBooruTokens(tags);
  if (tokens.length === 0) return [...current];
  const map = new Map(current.map((row) => [row.en, { ...row, sites: [...row.sites] }]));
  for (const en of tokens) {
    const prev = map.get(en);
    if (prev) {
      prev.count += 1;
      prev.lastSeen = at;
      if (!prev.sites.includes(source)) prev.sites.push(source);
    } else {
      map.set(en, { en, count: 1, lastSeen: at, sites: [source] });
    }
  }
  const next = [...map.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen || a.en.localeCompare(b.en));
  if (next.length <= TAG_CATALOG_MAX) return next;
  return next.slice(0, TAG_CATALOG_MAX);
}

export const useTagCatalog = create<CatalogState>()(
  persist(
    (set, get) => ({
      entries: [],
      ingest: (source, tags) => set({ entries: mergeCatalog(get().entries, source, tags) }),
      ingestMany: (items) => {
        let entries = get().entries;
        const at = Date.now();
        for (const item of items) {
          if (!item.tags?.length) continue;
          entries = mergeCatalog(entries, item.source, item.tags, at);
        }
        set({ entries });
      },
    }),
    { name: "kami-tag-catalog", version: 1 },
  ),
);

const pending = new Map<string, { source: BooruSite; tags: string[] }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPending() {
  flushTimer = null;
  const batch = [...pending.values()];
  pending.clear();
  if (batch.length === 0) return;
  useTagCatalog.getState().ingestMany(batch);
}

/** 浏览卡片高频调用，合并进一次写入。 */
export function collectBooruTags(source: Source, tags: readonly string[] | undefined) {
  if (!isBooruSite(source) || !tags?.length) return;
  const tokens = splitBooruTokens(tags);
  if (tokens.length === 0) return;
  const prev = pending.get(source);
  pending.set(source, { source, tags: [...(prev?.tags ?? []), ...tokens] });
  if (flushTimer) return;
  flushTimer = setTimeout(flushPending, FLUSH_MS);
}

export function catalogKeys(entries: readonly TagCatalogEntry[]): string[] {
  return entries.map((row) => row.en);
}
