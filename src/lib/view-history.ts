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
  /** 最后浏览到的页（0-based 水位，长漫画续读）。关灯箱写一次；只认 [0, pageCount) 内的整数。缺 = 没翻过或旧记录。 */
  lastPage?: number;
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
  // 同 key 旧水位结转（upsertAuthorHistory 结转 name/avatar 同模式）：rememberView 走
  // historyEntryFromWork 重建条目、不带 lastPage，不结转则每次打开详情都冲掉续读水位；
  // clamp 到新 pageCount−1——重开时页数缩水，旧水位不得越界。条目自带 lastPage 优先。
  const prev = items.find((x) => `${x.source}:${x.id}` === key);
  const carried = entry.lastPage ?? clampPage(prev?.lastPage, entry.pageCount);
  const next = carried === undefined ? entry : { ...entry, lastPage: carried };
  return pruneHistory([next, ...items.filter((x) => `${x.source}:${x.id}` !== key)]);
}

/** 水位只认 [0, pageCount−1]：无值原样过，越界截到末页（条目 pageCount ≥ 1 是入史时的不变量）。 */
function clampPage(value: number | undefined, pageCount: number): number | undefined {
  return value === undefined ? undefined : Math.min(value, pageCount - 1);
}

/**
 * 续读定位页（详情页打开后滚到哪）：没写过水位、单页、clamp 后落在首页（等于没翻过）
 * 或末页（看完，不打扰）都返回 null 不定位；其余返回 clamp 进页数的定位页。
 * 为什么 clamp 两次：水位可能来自 pageCount 更大的旧记录（作品改版）。
 */
export function resumePage(entry: HistoryEntry | undefined, pageCount: number): number | null {
  if (entry?.lastPage === undefined || pageCount <= 1) return null;
  const page = Math.min(entry.lastPage, pageCount - 1);
  return page <= 0 || page >= pageCount - 1 ? null : page;
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

/** 续读水位的持久层形态：整数、0 ≤ v < 10000。越界/小数当没写过，不给脏数据入史。 */
function finitePage(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 10_000
    ? value
    : undefined;
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
    // 白名单重建：新字段必须在这里带回，否则 migrate/迁移路径一过就丢（lastPage 之鉴）。
    const pageCount = Math.max(1, Number(r.pageCount) || 1);
    const lastPage = finitePage(r.lastPage);
    out.push({
      source,
      id,
      title: typeof r.title === "string" ? r.title : id,
      author: typeof r.author === "string" ? r.author : "",
      authorId: typeof r.authorId === "string" ? r.authorId : "",
      thumb: typeof r.thumb === "string" ? r.thumb : "",
      pageCount,
      lastPage: clampPage(lastPage, pageCount),
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
  /** 写续读水位：条目存在才原位 patch（clamp 进该条目页数），不存在/页码非法 no-op。 */
  setLastPage: (source: Source, id: string, page: number) => void;
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
      setLastPage: (source, id, page) =>
        set((s) => {
          // 不存在则原样返回（zustand 同引用不通知）：不为水位凭空造历史条目、也不空转重渲
          if (!s.items.some((x) => x.source === source && x.id === id)) return s;
          return {
            items: s.items.map((x) => {
              if (x.source !== source || x.id !== id) return x;
              const p = clampPage(finitePage(page), x.pageCount);
              return p === undefined ? x : { ...x, lastPage: p };
            }),
          };
        }),
      clear: () => set({ items: [], authors: [] }),
      prune: () => set((s) => ({ items: pruneHistory(s.items) })),
    }),
    {
      name: HISTORY_STORAGE_KEY,
      // v3 = lastPage 续读水位。zustand 版本不等即 migrate（任一方向）：升级过一次
      // parseHistoryItems 白名单把水位带回来；回滚 v2 代码重解析只丢水位不丢条目。
      version: 3,
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
