/**
 * 浏览历史。
 *
 * 作用：打开过的作品和作者按时间倒序记下来，历史页还能点回去。
 * 用法：作品页 rememberView(work)；画师/创作者页 rememberAuthor(...)；页面用 useViewHistory。
 * 为什么：不塞进设置（Cookie 已经够大）。作品按 90 天过期，不设条数上限。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PIXIV_AI_TAGS } from "./pixiv-feed.ts";
import type { Source, WorkCard } from "./types.ts";

export const HISTORY_LIMIT = 20_000;
export const AUTHOR_HISTORY_LIMIT = 400;
export const HISTORY_DAYS = 90;
export const HISTORY_STORAGE_KEY = "kami-history";

export type HistoryEntry = {
  source: Source;
  id: string;
  title: string;
  author: string;
  authorId: string;
  thumb: string;
  pageCount: number;
  width?: number;
  height?: number;
  viewedAt: number;
  /** 打开时的分级和 AI 标记。遮盖靠这些判断。缺了就是更早的记录，再打开一次会补上。显式 0 要留着。 */
  aiType?: number;
  xRestrict?: number;
  rating?: string;
  /** 只留能让遮盖认出 AI 的词，不把整份标签表写进历史。 */
  tags?: string[];
};

export type AuthorHistoryEntry = {
  source: "pixiv" | "fanbox";
  id: string;
  name: string;
  avatar: string;
  viewedAt: number;
};

export function historyCutoff(now = Date.now(), days = HISTORY_DAYS): number {
  return now - days * 24 * 60 * 60_000;
}

export function pruneHistory(items: HistoryEntry[], now = Date.now()): HistoryEntry[] {
  const cut = historyCutoff(now);
  return items.filter((row) => row.viewedAt >= cut);
}

export function upsertHistory(items: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const key = `${entry.source}:${entry.id}`;
  return pruneHistory([entry, ...items.filter((x) => `${x.source}:${x.id}` !== key)]);
}

export function upsertAuthorHistory(
  items: AuthorHistoryEntry[],
  entry: AuthorHistoryEntry,
): AuthorHistoryEntry[] {
  const prev = items.find((x) => x.source === entry.source && x.id === entry.id);
  const next: AuthorHistoryEntry = {
    ...entry,
    name: entry.name || prev?.name || entry.id,
    avatar: entry.avatar || prev?.avatar || "",
  };
  return [next, ...items.filter((x) => !(x.source === entry.source && x.id === entry.id))].slice(
    0,
    AUTHOR_HISTORY_LIMIT,
  );
}

/** 遮盖认 AI 只用这几个词。历史不存其余标签。 */
export function historyAiTags(tags: readonly string[] | undefined): string[] | undefined {
  const hit = (tags ?? []).filter((tag) => PIXIV_AI_TAGS.has(tag.trim().toLowerCase()));
  return hit.length > 0 ? hit : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 从作品抄进历史的分级。0 和空分级都要留下，不能当成没填过。 */
export function historyEntryFromWork(work: WorkCard, viewedAt: number): HistoryEntry {
  const tags = historyAiTags(work.tags);
  return {
    source: work.source,
    id: work.id,
    title: work.title,
    author: work.author,
    authorId: work.authorId,
    thumb: work.thumb,
    pageCount: work.pageCount || 1,
    width: work.width,
    height: work.height,
    viewedAt,
    ...(work.aiType !== undefined ? { aiType: work.aiType } : {}),
    ...(work.xRestrict !== undefined ? { xRestrict: work.xRestrict } : {}),
    ...(typeof work.rating === "string" ? { rating: work.rating } : {}),
    ...(tags ? { tags } : {}),
  };
}

export function historyToCard(entry: HistoryEntry): WorkCard {
  return {
    source: entry.source,
    id: entry.id,
    title: entry.title,
    author: entry.author,
    authorId: entry.authorId,
    thumb: entry.thumb,
    pageCount: entry.pageCount,
    tags: entry.tags ?? [],
    width: entry.width,
    height: entry.height,
    aiType: entry.aiType,
    xRestrict: entry.xRestrict,
    rating: entry.rating,
  };
}

const SOURCES: Source[] = ["pixiv", "fanbox", "yande", "konachan", "danbooru"];

export function parseHistoryItems(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const source = SOURCES.includes(r.source as Source) ? (r.source as Source) : null;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!source || !id) continue;
    out.push({
      source,
      id,
      title: typeof r.title === "string" ? r.title : id,
      author: typeof r.author === "string" ? r.author : "",
      authorId: typeof r.authorId === "string" ? r.authorId : "",
      thumb: typeof r.thumb === "string" ? r.thumb : "",
      pageCount: Math.max(1, Number(r.pageCount) || 1),
      width: Number(r.width) > 0 ? Number(r.width) : undefined,
      height: Number(r.height) > 0 ? Number(r.height) : undefined,
      viewedAt: Number(r.viewedAt) || 0,
      aiType: finiteNumber(r.aiType),
      xRestrict: finiteNumber(r.xRestrict),
      rating: typeof r.rating === "string" ? r.rating : undefined,
      tags: historyAiTags(Array.isArray(r.tags) ? r.tags.filter((tag): tag is string => typeof tag === "string") : undefined),
    });
    if (out.length >= 50_000) break;
  }
  return out;
}

export function parseAuthorHistory(raw: unknown): AuthorHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AuthorHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const source = r.source === "pixiv" || r.source === "fanbox" ? r.source : null;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!source || !id) continue;
    out.push({
      source,
      id,
      name: typeof r.name === "string" && r.name.trim() ? r.name : id,
      avatar: typeof r.avatar === "string" ? r.avatar : "",
      viewedAt: Number(r.viewedAt) || 0,
    });
    if (out.length >= AUTHOR_HISTORY_LIMIT) break;
  }
  return out;
}

type ViewHistoryState = {
  items: HistoryEntry[];
  authors: AuthorHistoryEntry[];
  push: (work: WorkCard) => void;
  pushAuthor: (author: Omit<AuthorHistoryEntry, "viewedAt">) => void;
  remove: (source: Source, id: string) => void;
  removeAuthor: (source: AuthorHistoryEntry["source"], id: string) => void;
  clear: () => void;
  prune: () => void;
};

export const useViewHistory = create<ViewHistoryState>()(
  persist(
    (set) => ({
      items: [],
      authors: [],
      push: (work) =>
        set((s) => ({
          items: upsertHistory(s.items, historyEntryFromWork(work, Date.now())),
        })),
      pushAuthor: (author) => {
        if (author.source !== "pixiv" && author.source !== "fanbox") return;
        if (!author.id) return;
        set((s) => ({
          authors: upsertAuthorHistory(s.authors, {
            source: author.source,
            id: author.id,
            name: author.name,
            avatar: author.avatar,
            viewedAt: Date.now(),
          }),
        }));
      },
      remove: (source, id) =>
        set((s) => ({
          items: s.items.filter((x) => !(x.source === source && x.id === id)),
        })),
      removeAuthor: (source, id) =>
        set((s) => ({
          authors: s.authors.filter((x) => !(x.source === source && x.id === id)),
        })),
      clear: () => set({ items: [], authors: [] }),
      prune: () => set((s) => ({ items: pruneHistory(s.items) })),
    }),
    {
      name: HISTORY_STORAGE_KEY,
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { items?: unknown; authors?: unknown };
        return {
          items: pruneHistory(parseHistoryItems(p.items)),
          authors: parseAuthorHistory(p.authors),
        };
      },
    },
  ),
);

export function rememberView(work: WorkCard) {
  if (!work.id || !work.source) return;
  useViewHistory.getState().push(work);
  if ((work.source === "pixiv" || work.source === "fanbox") && work.authorId) {
    useViewHistory.getState().pushAuthor({
      source: work.source,
      id: work.authorId,
      name: work.author,
      avatar: "",
    });
  }
}

export function rememberAuthor(author: Omit<AuthorHistoryEntry, "viewedAt">) {
  useViewHistory.getState().pushAuthor(author);
}
