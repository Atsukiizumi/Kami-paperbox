/**
 * 浏览历史。
 *
 * 作用：打开过的作品按时间倒序记下来，历史页还能点回去。
 * 用法：作品页 rememberView(work)；页面用 useViewHistory。
 * 为什么：不塞进设置（Cookie 已经够大）。只存封面卡片，最多 200 条。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Source, WorkCard } from "./types";

export const HISTORY_LIMIT = 200;
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
};

export function upsertHistory(items: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const key = `${entry.source}:${entry.id}`;
  return [entry, ...items.filter((x) => `${x.source}:${x.id}` !== key)].slice(0, HISTORY_LIMIT);
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
    tags: [],
    width: entry.width,
    height: entry.height,
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
    });
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

type ViewHistoryState = {
  items: HistoryEntry[];
  push: (work: WorkCard) => void;
  remove: (source: Source, id: string) => void;
  clear: () => void;
};

export const useViewHistory = create<ViewHistoryState>()(
  persist(
    (set) => ({
      items: [],
      push: (work) =>
        set((s) => ({
          items: upsertHistory(s.items, {
            source: work.source,
            id: work.id,
            title: work.title,
            author: work.author,
            authorId: work.authorId,
            thumb: work.thumb,
            pageCount: work.pageCount || 1,
            width: work.width,
            height: work.height,
            viewedAt: Date.now(),
          }),
        })),
      remove: (source, id) =>
        set((s) => ({
          items: s.items.filter((x) => !(x.source === source && x.id === id)),
        })),
      clear: () => set({ items: [] }),
    }),
    {
      name: HISTORY_STORAGE_KEY,
      version: 1,
      migrate: (persisted) => ({
        items: parseHistoryItems((persisted as { items?: unknown } | null)?.items),
      }),
    },
  ),
);

export function rememberView(work: WorkCard) {
  if (!work.id || !work.source) return;
  useViewHistory.getState().push(work);
}
