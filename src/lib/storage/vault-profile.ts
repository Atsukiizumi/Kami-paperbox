/**
 * 纸匣用户画像聚合（纯函数，不碰 IndexedDB）。
 *
 * 作用：在 listVault() 拿到的 VaultMeta[] 上推导「这个纸匣主人的收藏习惯」——
 *      按小时 / 周几的收藏节奏、标签词云分档、来源构成、画像小结语字段；
 *      末尾另附回顾三件套（今日去年 onThisDay / 年度报告 reportNarrative /
 *      随手翻一张 pickRandom），同样只吃数组吐结构。标签聚合口径走
 *      vault-tag-alias.ts 的别名表（词云与兴趣坐标合并变体计数）。
 * 用法：const hours = hourHistogram(items); const summary = profileSummary(items)。
 *      只吃数组吐结构，零 IO，Node 单测直接跑（同 vault-query.ts 的拆法）。
 *      别名表由调用方从设置段带进 opts / 参数，缺省恒等（旧口径不变）。
 * 为什么：统计页要的不是「分布数字」而是「读法」。聚合与措辞分开——这里只给
 *        字段，中文句子由页面拼；空库 / 缺字段时返回 null，页面隐藏对应半句，
 *        不在这里猜默认文案。钟点 / 周几都按浏览器本地时区（收藏是本地行为）。
 */
import { applyAuthorAlias, clusterAuthorVariants } from "../author-name.ts";
import { applyTagAlias } from "../vault-tag-alias.ts";
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
 * 标签词云（lite）：按张数定字号 / 墨深档位。
 * 档位对最大张数做对数映射——count=max 定 5 档、count=1 定 1 档，
 * 中间按 log 比例取整，保证档位随张数单调不减（同档允许并列）。
 * opts.tagAliases 计数前归一：同一事物的变体并成一个规范名；**按张去重**——
 * 同一张图同时带「鳴潮+鸣潮」两个变体时只计一张（chip.count 就是真实张数）。
 */
export function tagCloud(
  items: VaultMeta[],
  opts?: { min?: number; limit?: number; tagAliases?: Record<string, string> },
): TagChip[] {
  const min = opts?.min ?? 1;
  const limit = opts?.limit ?? 40;
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const raw of item.tags) {
      const tag = applyTagAlias(raw.trim(), opts?.tagAliases);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
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
export function profileSummary(items: VaultMeta[], aliases?: Record<string, string>): ProfileSummary {
  if (items.length === 0) {
    return { favoriteAuthor: null, topTag: null, spanDays: null, activePhase: null, topWeekday: null };
  }

  // 心头好按 authorKey 簇计数（同 authorId / 规范化同名归一，装饰变体不再分票）；
  // 展示名取簇内最新 raw 经规范化，再套用户别名。
  const authorCounts = new Map<string, { name: string; count: number }>();
  for (const cluster of clusterAuthorVariants(items)) {
    authorCounts.set(cluster.key, { name: applyAuthorAlias(cluster.displayName, aliases), count: cluster.totalCount });
  }
  const tagCounts = new Map<string, number>();
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const item of items) {
    // topTag 与词云同口径：别名归一 + 按张去重（同图双变体只计一张）。
    const seenTags = new Set<string>();
    for (const raw of item.tags) {
      const tag = applyTagAlias(raw.trim(), aliases);
      if (!tag || seenTags.has(tag)) continue;
      seenTags.add(tag);
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
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
  let topAuthor: { name: string; count: number } | null = null;
  for (const row of authorCounts.values()) {
    if (!topAuthor || row.count > topAuthor.count || (row.count === topAuthor.count && row.name < topAuthor.name)) {
      topAuthor = row;
    }
  }
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

// ── 回顾三件套（今日去年 / 年度报告 / 随手翻一张）─────────────────────

/** 本地时区「月-日」键。闰日按字面匹配：2-29 收的只在闰年的 2-29 命中。 */
function monthDayKey(savedAt: number): string {
  const d = new Date(savedAt);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export type OnThisDayGroup = {
  /** 命中年份（严格早于当前年）。 */
  year: number;
  /** 那一年的今天收的藏品（保持传入顺序）。 */
  items: VaultMeta[];
};

/**
 * 今日去年：savedAt 的月-日与今日相同、年份早于今年的藏品，按年份降序分组
 * （去年的今天排最前）。空输入 / 无命中返回 []。页面拿 items 过滤列表，
 * 拿分组拼「去年的今天 N 张」的笺条与续报。
 */
export function onThisDay(items: VaultMeta[], now: number): OnThisDayGroup[] {
  const want = monthDayKey(now);
  const thisYear = new Date(now).getFullYear();
  const groups = new Map<number, VaultMeta[]>();
  for (const item of items) {
    const d = new Date(item.savedAt);
    if (d.getFullYear() >= thisYear) continue;
    if (monthDayKey(item.savedAt) !== want) continue;
    const bucket = groups.get(d.getFullYear());
    if (bucket) bucket.push(item);
    else groups.set(d.getFullYear(), [item]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, bucket]) => ({ year, items: bucket }));
}

/** 年份切片（本地时区）：年度报告的聚合输入——切片直接喂既有画像函数，不另写聚合。 */
export function filterByYear(items: VaultMeta[], year: number): VaultMeta[] {
  return items.filter((item) => new Date(item.savedAt).getFullYear() === year);
}

/** 藏品覆盖的年份（降序）；报告页年份选择器的选项来源。 */
export function vaultYears(items: VaultMeta[]): number[] {
  return [...new Set(items.map((item) => new Date(item.savedAt).getFullYear()))].sort((a, b) => b - a);
}

const MONTH_LABELS = [
  "1 月",
  "2 月",
  "3 月",
  "4 月",
  "5 月",
  "6 月",
  "7 月",
  "8 月",
  "9 月",
  "10 月",
  "11 月",
  "12 月",
];

export type ReportAuthorRow = { name: string; count: number; /** 占年切片总数的整数百分比。 */ pct: number };

export type ReportNarrative = {
  year: number;
  total: number;
  /** 最勤的一个月（并列取最早月份）。 */
  peakMonth: { label: string; count: number } | null;
  /** 心头好 Top 3：簇口径与统计页一致（同 authorId / 规范化同名归一）；无名作者不参与。 */
  topAuthors: ReportAuthorRow[];
  /** 兴趣坐标 Top 5 标签（tagCloud 复用，自带字号 / 墨深分档）。 */
  topTags: TagChip[];
  /** 收藏节奏：峰值相位（凌晨 / 清晨 / … / 深夜）。 */
  activePhase: string | null;
  /** 收藏节奏：最爱周几（周一 … 周日）。 */
  topWeekday: string | null;
  /** 之最：字节最大的一张（全部为 0 时 null；并列保留数组中先出现的一条）。 */
  largestByBytes: { title: string; bytes: number } | null;
  /** 之最：页数最多的一张（不足两页不算「多图」，null——宁缺不编）。 */
  largestByPages: { title: string; pageCount: number } | null;
  /** 年内收藏跨度（最早 → 最近，含首尾时刻供排版；切片非空时必有）。 */
  span: { days: number; firstAt: number; lastAt: number };
  /** 结束语：只从标签 / 画师数据确定性推导，两样都读不出返回 null（宁缺不编）。 */
  closing: string | null;
};

/**
 * 年度报告文案字段集：吃一个年份切片（filterByYear 的产物），吐六段版式要的
 * 全部字段，页面只拼版不计算。切片为空返回 null（页面走空态）。聚合全部
 * 复用本文件既有函数（直方图 / 峰值 / 词云 / 画师簇），不另写第二套口径。
 * aliases 是画师别名；tagAliases 透传给词云（兴趣坐标 Top 5 合并变体计数）。
 */
export function reportNarrative(
  slice: VaultMeta[],
  year: number,
  aliases?: Record<string, string>,
  tagAliases?: Record<string, string>,
): ReportNarrative | null {
  if (slice.length === 0) return null;

  const monthCounts = new Array<number>(12).fill(0);
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let bigBytes: VaultMeta | null = null;
  let bigPages: VaultMeta | null = null;
  for (const item of slice) {
    monthCounts[new Date(item.savedAt).getMonth()] += 1;
    first = Math.min(first, item.savedAt);
    last = Math.max(last, item.savedAt);
    if (!bigBytes || item.bytes > bigBytes.bytes) bigBytes = item;
    if (item.pageCount >= 2 && (!bigPages || item.pageCount > bigPages.pageCount)) bigPages = item;
  }

  const peakMonth = peakBucket(monthCounts);
  const peakHour = peakBucket(hourHistogram(slice));
  const peakDay = peakBucket(weekdayHistogram(slice));
  const topAuthors = clusterAuthorVariants(slice)
    .slice(0, 3)
    .map((cluster) => ({
      name: applyAuthorAlias(cluster.displayName, aliases),
      count: cluster.totalCount,
      pct: Math.round((cluster.totalCount / slice.length) * 100),
    }));
  const topTags = tagCloud(slice, { limit: 5, tagAliases });

  let closing: string | null = null;
  if (topTags[0]) {
    const rate = Math.min(100, Math.round((topTags[0].count / slice.length) * 100));
    closing = `${year} 年，「${topTags[0].tag}」出现在你 ${rate}% 的收藏里。`;
  } else if (topAuthors[0]) {
    closing = `${year} 年，你在「${topAuthors[0].name}」那里收下了 ${topAuthors[0].count} 张。`;
  }

  return {
    year,
    total: slice.length,
    peakMonth: peakMonth ? { label: MONTH_LABELS[peakMonth.index] ?? "", count: peakMonth.count } : null,
    topAuthors,
    topTags,
    activePhase: peakHour ? hourPhaseName(peakHour.index) : null,
    topWeekday: peakDay ? weekdayName(peakDay.index) : null,
    largestByBytes: bigBytes && bigBytes.bytes > 0 ? { title: bigBytes.title, bytes: bigBytes.bytes } : null,
    largestByPages: bigPages ? { title: bigPages.title, pageCount: bigPages.pageCount } : null,
    span: { days: Math.round((last - first) / 86_400_000), firstAt: first, lastAt: last },
    closing,
  };
}

/**
 * 封面是否「翻得出来」：与纸匣卡片取封面的链路一一对应——服务器存过第 0 页
 * （hasFile）/ 用户文件夹有副本（relativePath，挂上目录就能预览）/ 应用内库
 * 存过像素（origin 不是 folder）。三处都够不着的条目不进翻牌池。
 */
export function hasVaultCover(item: VaultMeta): boolean {
  if (item.hasFile === true) return true;
  if (item.relativePath) return true;
  return item.origin !== "folder";
}

/**
 * 随手翻一张：从有封面可翻的藏品里均匀随机挑一条。rng 可注入（测试定序）；
 * 池空（空匣 / 全是翻不出封面的条目）返回 null。换牌时避免重复的兜底
 * （连抽避开同一张）由调用方做，这里只保证一次抽取的均匀与确定性。
 */
export function pickRandom(items: VaultMeta[], rng: () => number = Math.random): VaultMeta | null {
  const pool = items.filter(hasVaultCover);
  if (pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[index];
}
