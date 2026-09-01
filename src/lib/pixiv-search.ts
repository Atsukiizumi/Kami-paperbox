/**
 * Pixiv 搜索条件（官网「搜索条件」弹层那一套）。
 *
 * 作用：把检索范围、作品类型、年龄、时间、收藏数、横竖图收成一份 filter，
 *      再拼 `/ajax/search/artworks` 的 query。
 * 用法：buildPixivSearchUrl(word, page, filter, { safeMode, hideAi })。
 * 为什么：现在搜索写死 `s_mode=s_tag&type=all&order=date_d`，和官网筛选项对不上。
 *        参数名跟 tags 页 URL 一致，方便对照。
 */

import { joinSearchTags, splitSearchTags } from "./site-tags.ts";

export const PIXIV_SEARCH_SCOPES = [
  { id: "s_tag", label: "标签（部分一致）" },
  { id: "s_tag_full", label: "标签（完全一致）" },
  { id: "s_tc", label: "标题、说明文" },
] as const;

export const PIXIV_SEARCH_TYPES = [
  { id: "all", label: "插画、漫画、动图" },
  { id: "illust", label: "插画" },
  { id: "manga", label: "漫画" },
  { id: "ugoira", label: "动图" },
] as const;

export const PIXIV_SEARCH_ORDERS = [
  { id: "date_d", label: "最新" },
  { id: "date", label: "最旧" },
  { id: "popular_d", label: "热门" },
] as const;

export const PIXIV_SEARCH_AGES = [
  { id: "all", label: "全部" },
  { id: "safe", label: "全年龄" },
  { id: "r18", label: "R-18" },
] as const;

export const PIXIV_SEARCH_WHEN = [
  { id: "any", label: "不限" },
  { id: "d", label: "过去 24 小时" },
  { id: "w", label: "过去一周" },
  { id: "m", label: "过去一个月" },
] as const;

export const PIXIV_SEARCH_BOOKMARKS = [
  { id: "0", label: "全部收藏数" },
  { id: "100", label: "100+" },
  { id: "250", label: "250+" },
  { id: "500", label: "500+" },
  { id: "1000", label: "1000+" },
  { id: "5000", label: "5000+" },
] as const;

export const PIXIV_SEARCH_RATIO = [
  { id: "all", label: "全部" },
  { id: "landscape", label: "横图" },
  { id: "portrait", label: "纵图" },
  { id: "square", label: "正方形" },
] as const;

export type PixivSearchScope = (typeof PIXIV_SEARCH_SCOPES)[number]["id"];
export type PixivSearchType = (typeof PIXIV_SEARCH_TYPES)[number]["id"];
export type PixivSearchOrder = (typeof PIXIV_SEARCH_ORDERS)[number]["id"];
export type PixivSearchAge = (typeof PIXIV_SEARCH_AGES)[number]["id"];
export type PixivSearchWhen = (typeof PIXIV_SEARCH_WHEN)[number]["id"];
export type PixivSearchBookmarks = (typeof PIXIV_SEARCH_BOOKMARKS)[number]["id"];
export type PixivSearchRatio = (typeof PIXIV_SEARCH_RATIO)[number]["id"];

export type PixivSearchFilter = {
  scope: PixivSearchScope;
  type: PixivSearchType;
  order: PixivSearchOrder;
  age: PixivSearchAge;
  when: PixivSearchWhen;
  bookmarks: PixivSearchBookmarks;
  ratio: PixivSearchRatio;
};

export const DEFAULT_PIXIV_SEARCH: PixivSearchFilter = {
  scope: "s_tag",
  type: "all",
  order: "date_d",
  age: "all",
  when: "any",
  bookmarks: "0",
  ratio: "all",
};

const SCOPES = new Set<string>(PIXIV_SEARCH_SCOPES.map((x) => x.id));
const TYPES = new Set<string>(PIXIV_SEARCH_TYPES.map((x) => x.id));
const ORDERS = new Set<string>(PIXIV_SEARCH_ORDERS.map((x) => x.id));
const AGES = new Set<string>(PIXIV_SEARCH_AGES.map((x) => x.id));
const WHENS = new Set<string>(PIXIV_SEARCH_WHEN.map((x) => x.id));
const BOOKMARKS = new Set<string>(PIXIV_SEARCH_BOOKMARKS.map((x) => x.id));
const RATIOS = new Set<string>(PIXIV_SEARCH_RATIO.map((x) => x.id));

function pick<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === "string" && allowed.has(value) ? (value as T) : fallback;
}

/** 点标签默认完全一致；搜索框打字默认部分一致。 */
export function scopeFromExact(exact: boolean): PixivSearchScope {
  return exact ? "s_tag_full" : "s_tag";
}

export function parsePixivSearchFilter(raw?: Partial<PixivSearchFilter> | null): PixivSearchFilter {
  const src = raw ?? {};
  return {
    scope: pick(src.scope, SCOPES, DEFAULT_PIXIV_SEARCH.scope),
    type: pick(src.type, TYPES, DEFAULT_PIXIV_SEARCH.type),
    order: pick(src.order, ORDERS, DEFAULT_PIXIV_SEARCH.order),
    age: pick(src.age, AGES, DEFAULT_PIXIV_SEARCH.age),
    when: pick(src.when, WHENS, DEFAULT_PIXIV_SEARCH.when),
    bookmarks: pick(src.bookmarks, BOOKMARKS, DEFAULT_PIXIV_SEARCH.bookmarks),
    ratio: pick(src.ratio, RATIOS, DEFAULT_PIXIV_SEARCH.ratio),
  };
}

/** 本地日历日，跟 Pixiv 投稿时间筛选用的 scd 一致。 */
export function localIsoDate(now: Date, daysAgo = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function scdForWhen(when: PixivSearchWhen, now = new Date()): string | undefined {
  if (when === "d") return localIsoDate(now, 1);
  if (when === "w") return localIsoDate(now, 7);
  if (when === "m") return localIsoDate(now, 30);
  return undefined;
}

export function countActivePixivSearch(filter: PixivSearchFilter): number {
  let n = 0;
  if (filter.scope !== DEFAULT_PIXIV_SEARCH.scope) n += 1;
  if (filter.type !== DEFAULT_PIXIV_SEARCH.type) n += 1;
  if (filter.order !== DEFAULT_PIXIV_SEARCH.order) n += 1;
  if (filter.age !== DEFAULT_PIXIV_SEARCH.age) n += 1;
  if (filter.when !== DEFAULT_PIXIV_SEARCH.when) n += 1;
  if (filter.bookmarks !== DEFAULT_PIXIV_SEARCH.bookmarks) n += 1;
  if (filter.ratio !== DEFAULT_PIXIV_SEARCH.ratio) n += 1;
  return n;
}

/**
 * 空格拆成多个标签。精确匹配时给每个词加上引号，避免被当成一个长标签。
 */
export function formatPixivSearchWord(word: string, scope: PixivSearchScope): string {
  const tags = splitSearchTags(word).map((t) => t.replace(/"/g, "").trim()).filter(Boolean);
  if (tags.length === 0) return word.trim();
  if (scope === "s_tag_full" && tags.length > 1) {
    return tags.map((t) => `"${t}"`).join(" ");
  }
  return joinSearchTags(tags);
}

/**
 * 打开安全模式时年龄强制 safe，避免 filter 里勾了 R-18 还打出去。
 * 收藏数 `blt` 和热门 `popular_d` 是 Premium 能力，没开时 Pixiv 可能当没这参数。
 */
export function buildPixivSearchUrl(
  word: string,
  page: number,
  filter: PixivSearchFilter,
  opts: { safeMode: boolean; hideAi: boolean; now?: Date },
): string {
  const q = formatPixivSearchWord(word, filter.scope);
  const encoded = encodeURIComponent(q);
  const mode = opts.safeMode ? "safe" : filter.age;
  const params = new URLSearchParams();
  params.set("word", q);
  params.set("order", filter.order);
  params.set("mode", mode);
  params.set("p", String(page));
  params.set("s_mode", filter.scope);
  params.set("type", filter.type);
  params.set("lang", "zh");
  if (opts.hideAi) params.set("ai_type", "1");
  const scd = scdForWhen(filter.when, opts.now);
  if (scd) params.set("scd", scd);
  if (filter.bookmarks !== "0") params.set("blt", filter.bookmarks);
  if (filter.ratio === "landscape") params.set("ratio", "0.5");
  if (filter.ratio === "portrait") params.set("ratio", "-0.5");
  if (filter.ratio === "square") params.set("ratio", "0");
  return `https://www.pixiv.net/ajax/search/artworks/${encoded}?${params.toString()}`;
}
