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

export function isAiWork(work: { aiType?: number; tags?: readonly string[] }): boolean {
  if (work.aiType === 2) return true;
  return (work.tags ?? []).some((t) => PIXIV_AI_TAGS.has(t.trim().toLowerCase()));
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function collectIllustRecords(raw: unknown): Record<string, unknown>[] {
  const root = asRecord(raw);
  const body = asRecord(root.body ?? root);
  const thumbs = asRecord(body.thumbnails);
  const buckets = [thumbs.illust, body.illusts, asRecord(body.illustManga).data];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length > 0) return bucket.map(asRecord);
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
