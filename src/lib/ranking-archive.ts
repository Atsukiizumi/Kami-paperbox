/**
 * 浏览器读写热榜快照。
 *
 * 作用：浏览日/周/月榜第一页成功后写入；历史榜页再读回来。
 * 用法：rememberRanking({ site, period, date, items })；listRankings()。
 */
import type { Source, WorkCard } from "./types";

export type RankPeriod = "daily" | "weekly" | "monthly";

export type RankSnapshotMeta = {
  id: string;
  site: Source;
  period: RankPeriod;
  date: string;
  fetchedAt: number;
  count: number;
};

export type RankSnapshot = RankSnapshotMeta & { items: WorkCard[] };

export function rankingPeriodOf(feed: string): RankPeriod | null {
  if (feed === "daily" || feed === "daily_r18") return "daily";
  if (feed === "weekly" || feed === "weekly_r18") return "weekly";
  if (feed === "monthly") return "monthly";
  return null;
}

export function isoFromPixivDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Pixiv 日榜中午 12:00 JST 才换，当天和未来的 date 参数会 404。不传则用最新已公布榜。 */
export function pixivRankingDateParam(iso: string, now = new Date()): string | undefined {
  const compact = iso.replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return undefined;
  if (compact >= `${y}${m}${d}`) return undefined;
  return compact;
}

export async function listRankings(site?: Source, period?: RankPeriod): Promise<RankSnapshotMeta[]> {
  const qs = new URLSearchParams();
  if (site) qs.set("site", site);
  if (period) qs.set("period", period);
  const res = await fetch(`/api/rankings?${qs}`);
  const json = (await res.json()) as { ok?: boolean; items?: RankSnapshotMeta[] };
  return json.items ?? [];
}

export async function loadRanking(id: string): Promise<RankSnapshot | null> {
  const res = await fetch(`/api/rankings?id=${encodeURIComponent(id)}`);
  const json = (await res.json()) as { ok?: boolean; snapshot?: RankSnapshot };
  return json.snapshot ?? null;
}

export async function rememberRanking(input: {
  site: Source;
  period: RankPeriod;
  date: string;
  items: WorkCard[];
}): Promise<void> {
  if (input.site === "fanbox" || input.site === "pixiv" || input.items.length === 0) return;
  await fetch("/api/rankings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => undefined);
}

export async function deleteRanking(id: string): Promise<void> {
  await fetch(`/api/rankings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function clearRankings(site: Source): Promise<void> {
  await fetch(`/api/rankings?site=${encodeURIComponent(site)}`, { method: "DELETE" });
}
