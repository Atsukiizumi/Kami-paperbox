/**
 * Pixiv 榜单/信息流的纯解析。
 *
 * 作用：榜单 mode 表、从 ajax JSON 抽出作品、判断 AI / 是否最后一页。
 * 用法：upstream.server 调这里；UI 只用 PIXIV_RANK_MODES 做按钮。
 * 为什么：JSON 形状经常变（illustId vs illust_id），集中兼容，方便单测。
 */
import { asRecord, asStringTrimmed as asString } from "./parse.ts";
export const PIXIV_RANK_MODES = [
  { id: "daily", label: "日榜", nsfw: false, login: false },
  { id: "weekly", label: "周榜", nsfw: false, login: false },
  { id: "monthly", label: "月榜", nsfw: false, login: false },
  { id: "rookie", label: "新人", nsfw: false, login: false },
  { id: "original", label: "原创", nsfw: false, login: false },
  { id: "male", label: "男性向", nsfw: false, login: false },
  { id: "female", label: "女性向", nsfw: false, login: false },
  { id: "daily_r18", label: "R-18 日", nsfw: true, login: true },
  { id: "weekly_r18", label: "R-18 周", nsfw: true, login: true },
] as const;

export type PixivRankMode = (typeof PIXIV_RANK_MODES)[number]["id"];

export const PIXIV_PERSONAL_FEEDS = [
  { id: "recommend", label: "为你推荐", login: true },
  { id: "following", label: "关注", login: true },
] as const;

export type PixivPersonalFeed = (typeof PIXIV_PERSONAL_FEEDS)[number]["id"];
export type PixivFeed = PixivPersonalFeed | PixivRankMode;

export const PIXIV_RANK_IDS = PIXIV_RANK_MODES.map((m) => m.id) as [
  PixivRankMode,
  ...PixivRankMode[],
];

export function isPixivRankMode(v: string): v is PixivRankMode {
  return PIXIV_RANK_MODES.some((m) => m.id === v);
}

export function rankingMeta(mode: PixivRankMode) {
  return PIXIV_RANK_MODES.find((m) => m.id === mode) ?? PIXIV_RANK_MODES[0];
}

export const PIXIV_AI_TAGS = new Set([
  "ai",
  "ai生成",
  "生成ai",
  "画像生成ai",
  "aiイラスト",
  "ai插画",
  "ai-generated",
  "ai generated",
  "stable diffusion",
  "novelai",
  "nijijourney",
  "midjourney",
]);

export function pixivAiType(raw: Record<string, unknown>): number {
  const v = raw.aiType ?? raw.illust_ai_type ?? raw.illustAiType;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

/** Pixiv aiType 实测定案（2026-10-28/29 三方对照）：**2=AI 生成，0/1=非 AI**（1 是
 * 「非 AI」的显式值，发现流几乎全量返回 1；榜单等接口干脆不带该字段）。
 * 对照记录：全 AI 画师（users/123191274）41/41=2；发现流 59/60=1 且经用户肉眼
 * 确认是手绘；「AI生成」标签搜索全量=1 是被账号 AI 显示设置过滤后的幸存者，
 * 不能当 AI 样本。曾误判 1=AI 又回滚，勿再翻案。 */
export function isAiWork(work: { aiType?: number; tags?: readonly string[] }): boolean {
  if (work.aiType === 2) return true;
  return (work.tags ?? []).some((t) => PIXIV_AI_TAGS.has(t.trim().toLowerCase()));
}

/**
 * 展示层过滤（发现流「原始批」专用）：R-18 档与 AI 档各自独立原地筛。
 * 发现流固定拉全池原始批（服务端不再按开关过滤），切开关 = 同一批内容原地增减，
 * 不换批、不吃另一档的旧缓存快照。对服务端已过滤的流（榜单/搜索等）是幂等 no-op。
 */
export function passPixivDisplayFilters(
  work: { xRestrict?: number; aiType?: number; tags?: readonly string[] },
  safeMode: boolean,
  hideAi: boolean,
): boolean {
  if (safeMode && (work.xRestrict ?? 0) > 0) return false;
  if (hideAi && isAiWork(work)) return false;
  return true;
}



/**
 * 从 Pixiv illust / 榜单 JSON 抽出标签名。
 *
 * 作用：作品页展示、点 tag 回浏览搜索。
 * 用法：collectPixivTags(body) 或 collectPixivTags(body.tags)。
 * 为什么：官网有时是 `{ tags: { tags: [{ tag }] } }`，有时直接是数组；
 *        以前只按一层解，作品页就会一张标签都没有。
 */
export function collectPixivTags(raw: unknown): string[] {
  if (!raw) return [];
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else {
    const rec = asRecord(raw);
    if (Array.isArray(rec.tags)) list = rec.tags;
    else {
      const nested = asRecord(rec.tags);
      if (Array.isArray(nested.tags)) list = nested.tags;
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    let tag = "";
    if (typeof item === "string") tag = item.trim();
    else {
      const rec = asRecord(item);
      tag = asString(rec.tag || rec.name || rec.tagName);
    }
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 40) break;
  }
  return out;
}

export function collectIllustRecords(raw: unknown): Record<string, unknown>[] {
  const root = asRecord(raw);
  const body = asRecord(root.body ?? root);
  const thumbs = asRecord(body.thumbnails);
  const buckets = [thumbs.illust, body.illusts, asRecord(body.illustManga).data];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length > 0) return bucket.map((v) => asRecord(v));
  }
  return [];
}

export function collectOrderedIds(raw: unknown): string[] {
  const body = asRecord(asRecord(raw).body ?? raw);
  const page = asRecord(body.page);
  const ids: string[] = [];
  const push = (v: unknown) => {
    const s = String(v ?? "");
    if (/^\d+$/.test(s) && !ids.includes(s)) ids.push(s);
  };
  if (Array.isArray(page.ids)) page.ids.forEach(push);
  const recs = Array.isArray(body.recommendedIllusts) ? body.recommendedIllusts : [];
  for (const rec of recs) {
    const row = asRecord(rec);
    push(row.illustId ?? row.id);
  }
  return ids;
}

export function orderCardsByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  if (ids.length === 0) return items;
  const map = new Map(items.map((item) => [item.id, item]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const hit = map.get(id);
    if (hit && !seen.has(id)) {
      out.push(hit);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) out.push(item);
  }
  return out;
}

export function isLastFeedPage(raw: unknown, itemCount: number): boolean {
  const body = asRecord(asRecord(raw).body ?? raw);
  const page = asRecord(body.page);
  if (typeof page.isLastPage === "boolean") return page.isLastPage;
  return itemCount < 12;
}

export function formatRankDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return raw;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
