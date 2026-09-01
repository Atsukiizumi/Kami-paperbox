/**
 * 浏览历史。
 *
 * 作用：打开过的作品和作者按时间倒序记下来，历史页还能点回去。
 * 用法：作品页 rememberView(work)；画师/创作者页 rememberAuthor(...)；页面用 useViewHistory。
 * 为什么：不塞进设置（Cookie 已经够大）。作品最多 200，作者最多 80。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Source, WorkCard } from "./types";

export const HISTORY_LIMIT = 200;
export const AUTHOR_HISTORY_LIMIT = 80;
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

export type AuthorHistoryEntry = {
  source: "pixiv" | "fanbox";
  id: string;
  name: string;
  avatar: string;
  viewedAt: number;
};

export function upsertHistory(items: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const key = `${entry.source}:${entry.id}`;
  return [entry, ...items.filter((x) => `${x.source}:${x.id}` !== key)].slice(0, HISTORY_LIMIT);
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
};

export const useViewHistory = create<ViewHistoryState>()(
  persist(
    (set) => ({
      items: [],
      authors: [],
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
    }),
    {
      name: HISTORY_STORAGE_KEY,
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { items?: unknown; authors?: unknown };
        return {
          items: parseHistoryItems(p.items),
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
