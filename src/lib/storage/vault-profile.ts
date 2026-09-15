/**
 * 纸匣用户画像聚合（纯函数，不碰 IndexedDB）。
 *
 * 作用：在 listVault() 拿到的 VaultMeta[] 上推导「这个纸匣主人的收藏习惯」——
 *      按小时 / 周几的收藏节奏、标签词云分档、来源构成、画像小结语字段。
 * 用法：const hours = hourHistogram(items); const summary = profileSummary(items)。
 *      只吃数组吐结构，零 IO，Node 单测直接跑（同 vault-query.ts 的拆法）。
 * 为什么：统计页要的不是「分布数字」而是「读法」。聚合与措辞分开——这里只给
 *        字段，中文句子由页面拼；空库 / 缺字段时返回 null，页面隐藏对应半句，
 *        不在这里猜默认文案。钟点 / 周几都按浏览器本地时区（收藏是本地行为）。
 */
import type { Source, VaultMeta } from "../types.ts";

/** 24 桶按本地钟点：hours[h] = 收藏在 h 点的藏品数。 */
export function hourHistogram(items: VaultMeta[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const item of items) hours[new Date(item.savedAt).getHours()] += 1;
  return hours;
}

/** 7 桶周一起：weekdays[0]=周一 … weekdays[6]=周日（本地时区）。 */
export function weekdayHistogram(items: VaultMeta[]): number[] {
  const weekdays = new Array<number>(7).fill(0);
  for (const item of items) weekdays[(new Date(item.savedAt).getDay() + 6) % 7] += 1;
  return weekdays;
}

/** 直方图峰值；并列取最早的一桶（小时取早的、周几取靠前的，读起来自然）。全零返回 null。 */
export function peakBucket(hist: readonly number[]): { index: number; count: number } | null {
  let index = -1;
  let count = 0;
  for (let i = 0; i < hist.length; i += 1) {
    if (hist[i] > count) {
      index = i;
      count = hist[i];
    }
  }
  return index < 0 ? null : { index, count };
}

/** 钟点相位名。边界 5/8/11/14/17/20 点；23 点仍属深夜（不再切第八段）。 */
export function hourPhaseName(hour: number): "凌晨" | "清晨" | "上午" | "午后" | "傍晚" | "夜晚" | "深夜" {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (h < 5) return "凌晨";
  if (h < 8) return "清晨";
  if (h < 11) return "上午";
  if (h < 14) return "午后";
  if (h < 17) return "傍晚";
  if (h < 20) return "夜晚";
  return "深夜";
}

/** weekdayHistogram 下标 → 周几名（周一起）。 */
export function weekdayName(index: number): string {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index] ?? "";
}

export type TagChip = { tag: string; count: number; scale: 1 | 2 | 3 | 4 | 5 };

/**
 * 标签词云（lite）：按频次定字号 / 墨深档位。
 * 档位对最大频次做对数映射——count=max 定 5 档、count=1 定 1 档，
 * 中间按 log 比例取整，保证档位随频次单调不减（同档允许并列）。
 */
export function tagCloud(items: VaultMeta[], opts?: { min?: number; limit?: number }): TagChip[] {
  const min = opts?.min ?? 1;
  const limit = opts?.limit ?? 40;
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const raw of item.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const rows = [...counts.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(0, limit));
  const max = rows[0]?.[1] ?? 0;
  return rows.map(([tag, count]) => ({ tag, count, scale: tagScale(count, max) }));
}

function tagScale(count: number, max: number): 1 | 2 | 3 | 4 | 5 {
  if (max <= 1 || count <= 1) return 1;
  const raw = 1 + Math.round((Math.log(count) / Math.log(max)) * 4);
  return Math.min(5, Math.max(1, raw)) as 1 | 2 | 3 | 4 | 5;
}

export type SourceSlice = { source: Source; count: number; pct: number };

/** 来源构成（堆叠条 + 图例）。pct 四舍五入到整数后严格合计 100（最大余数法补差）。 */
export function sourceComposition(items: VaultMeta[]): SourceSlice[] {
  if (items.length === 0) return [];
  const counts = new Map<Source, number>();
  for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([source, count]) => ({ source, count, pct: Math.floor((count / items.length) * 100) }));

  // 最大余数法：先把小数部分大的桶补 1，补到合计恰好 100（并列按上面的排序取先）。
  const gap = 100 - rows.reduce((n, r) => n + r.pct, 0);
  if (gap > 0) {
    const order = rows
      .map((r, i) => ({ i, frac: (r.count / items.length) * 100 - r.pct }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < gap; k += 1) rows[order[k % order.length].i].pct += 1;
  }
  return rows;
}

export type ProfileSummary = {
  /** 心头好画师：出现最多的具名作者（无名作者不参与；并列取字典序靠前）。 */
  favoriteAuthor: { name: string; count: number } | null;
  /** 出现率最高的标签及其覆盖率（0-1，出现在多少比例的藏品上）。 */
  topTag: { tag: string; rate: number } | null;
  /** 最早与最近一次收藏之间隔了多少天（单条藏品为 0）。 */
  spanDays: number | null;
  /** 收藏最集中的钟点相位（凌晨 / 清晨 / … / 深夜）。 */
  activePhase: string | null;
  /** 收藏最多的周几（周一 … 周日）。 */
  topWeekday: string | null;
};

/** 画像小结语字段集：页面拼句子，null 字段对应半句直接隐藏。 */
export function profileSummary(items: VaultMeta[]): ProfileSummary {
  if (items.length === 0) {
    return { favoriteAuthor: null, topTag: null, spanDays: null, activePhase: null, topWeekday: null };
  }

  const authorCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const item of items) {
    const name = item.author.trim();
    if (name) authorCounts.set(name, (authorCounts.get(name) ?? 0) + 1);
    for (const raw of item.tags) {
      const tag = raw.trim();
      if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    first = Math.min(first, item.savedAt);
    last = Math.max(last, item.savedAt);
  }

  const topByCount = (counts: Map<string, number>): { name: string; count: number } | null => {
    let best: { name: string; count: number } | null = null;
    for (const [name, count] of counts) {
      if (!best || count > best.count || (count === best.count && name < best.name)) best = { name, count };
    }
    return best;
  };
  const topAuthor = topByCount(authorCounts);
  const topTagRow = topByCount(tagCounts);
  const peakHour = peakBucket(hourHistogram(items));
  const peakDay = peakBucket(weekdayHistogram(items));

  return {
    favoriteAuthor: topAuthor,
    topTag: topTagRow ? { tag: topTagRow.name, rate: topTagRow.count / items.length } : null,
    spanDays: Math.round((last - first) / 86_400_000),
    activePhase: peakHour ? hourPhaseName(peakHour.index) : null,
    topWeekday: peakDay ? weekdayName(peakDay.index) : null,
  };
}
