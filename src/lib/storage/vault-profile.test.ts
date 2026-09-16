import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterByYear,
  hourHistogram,
  hourPhaseName,
  onThisDay,
  peakBucket,
  pickRandom,
  profileSummary,
  reportNarrative,
  sourceComposition,
  tagCloud,
  vaultYears,
  weekdayHistogram,
  weekdayName,
} from "./vault-profile.ts";
import type { VaultMeta } from "../types.ts";

function item(over: Partial<VaultMeta> & Pick<VaultMeta, "key" | "title" | "author">): VaultMeta {
  return {
    source: "pixiv",
    id: over.id ?? over.key,
    authorId: "",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 100,
    ...over,
  };
}

/** 本地时区构造某个钟点的时间戳（收藏节奏按本地钟点统计）。 */
function at(year: number, month: number, day: number, hour: number, minute = 30): number {
  return new Date(year, month, day, hour, minute).getTime();
}

test("空输入：直方图全零、峰值 null、词云 / 构成空、画像字段全 null", () => {
  assert.deepEqual(hourHistogram([]), new Array(24).fill(0));
  assert.deepEqual(weekdayHistogram([]), new Array(7).fill(0));
  assert.equal(peakBucket(hourHistogram([])), null);
  assert.deepEqual(tagCloud([]), []);
  assert.deepEqual(sourceComposition([]), []);
  assert.deepEqual(profileSummary([]), {
    favoriteAuthor: null,
    topTag: null,
    spanDays: null,
    activePhase: null,
    topWeekday: null,
  });
});

test("hourHistogram 按本地钟点落桶", () => {
  const rows = [
    item({ key: "a", title: "a", author: "x", savedAt: at(2026, 8, 14, 23) }),
    item({ key: "b", title: "b", author: "x", savedAt: at(2026, 8, 15, 0) }),
    item({ key: "c", title: "c", author: "x", savedAt: at(2026, 8, 16, 23) }),
  ];
  const hours = hourHistogram(rows);
  assert.equal(hours[23], 2);
  assert.equal(hours[0], 1);
  assert.equal(hours.reduce((n, h) => n + h, 0), 3);
});

test("相位边界：5/8/11/14/17/20 各开一段，23 仍属深夜", () => {
  const table: [number, string][] = [
    [0, "凌晨"],
    [4, "凌晨"],
    [5, "清晨"],
    [7, "清晨"],
    [8, "上午"],
    [10, "上午"],
    [11, "午后"],
    [13, "午后"],
    [14, "傍晚"],
    [16, "傍晚"],
    [17, "夜晚"],
    [19, "夜晚"],
    [20, "深夜"],
    [23, "深夜"],
  ];
  for (const [hour, name] of table) assert.equal(hourPhaseName(hour), name, `hour ${hour}`);
});

test("weekdayHistogram 周一起：2026-09-14 是周一、09-20 是周日", () => {
  assert.equal(new Date(2026, 8, 14).getDay(), 1); // 基准日自证：周一
  const rows = [
    item({ key: "mon", title: "m", author: "x", savedAt: at(2026, 8, 14, 10) }),
    item({ key: "sun", title: "s", author: "x", savedAt: at(2026, 8, 20, 10) }),
    item({ key: "tue", title: "t", author: "x", savedAt: at(2026, 8, 15, 10) }),
  ];
  const weekdays = weekdayHistogram(rows);
  assert.equal(weekdays[0], 1); // 周一
  assert.equal(weekdays[1], 1); // 周二
  assert.equal(weekdays[6], 1); // 周日
  assert.equal(weekdayName(0), "周一");
  assert.equal(weekdayName(6), "周日");
});

test("peakBucket 并列取最早一桶；全零返回 null", () => {
  assert.deepEqual(peakBucket([0, 3, 3, 2]), { index: 1, count: 3 });
  assert.deepEqual(peakBucket([5]), { index: 0, count: 5 });
  assert.deepEqual(peakBucket([0, 0]), null);
});

test("tagCloud：max 定 5 档、count=1 定 1 档、档位随频次单调不减；limit / min 生效", () => {
  const rows: VaultMeta[] = [
    item({ key: "a", title: "a", author: "x", tags: ["sky", "night", "girl", "solo"] }),
    item({ key: "b", title: "b", author: "x", tags: ["sky", "night", "girl"] }),
    item({ key: "c", title: "c", author: "x", tags: ["sky", "night"] }),
    item({ key: "d", title: "d", author: "x", tags: ["sky"] }),
    item({ key: "e", title: "e", author: "x", tags: ["  "] }), // 空白标签被剔除
  ];
  const chips = tagCloud(rows);
  assert.deepEqual(
    chips.map((c) => c.tag),
    ["sky", "night", "girl", "solo"], // 空白标签被剔除，同频按字典序
  );
  const byTag = new Map(chips.map((c) => [c.tag, c]));
  assert.equal(byTag.get("sky")?.scale, 5); // count = max
  assert.equal(byTag.get("solo")?.scale, 1); // count = 1
  const sorted = [...chips].sort((a, b) => b.count - a.count);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i - 1].scale >= sorted[i].scale, `${sorted[i - 1].tag} >= ${sorted[i].tag}`);
  }
  assert.deepEqual(
    tagCloud(rows, { min: 2 }).map((c) => c.tag),
    ["sky", "night", "girl"],
  );
  assert.equal(tagCloud(rows, { limit: 2 }).length, 2);
});

test("sourceComposition：pct 四舍五入后严格合计 100，按计数降序", () => {
  const rows = [
    item({ key: "a", title: "a", author: "x", source: "pixiv" }),
    item({ key: "b", title: "b", author: "x", source: "pixiv" }),
    item({ key: "c", title: "c", author: "x", source: "yande" }),
  ];
  const slices = sourceComposition(rows);
  assert.deepEqual(
    slices.map((s) => s.source),
    ["pixiv", "yande"],
  );
  assert.equal(slices.reduce((n, s) => n + s.pct, 0), 100);
  assert.deepEqual(
    slices.map((s) => s.pct),
    [67, 33],
  );
  // 三等分：33+33+33=99，最大余数补给排序第一的桶
  const even = sourceComposition([
    item({ key: "a", title: "a", author: "x", source: "pixiv" }),
    item({ key: "b", title: "b", author: "x", source: "danbooru" }),
    item({ key: "c", title: "c", author: "x", source: "konachan" }),
  ]);
  assert.equal(even.reduce((n, s) => n + s.pct, 0), 100);
});

test("profileSummary：单条藏品的边界语义", () => {
  const rows = [item({ key: "a", title: "a", author: "Zero", tags: ["sky"], savedAt: at(2026, 8, 14, 21) })];
  const s = profileSummary(rows);
  assert.deepEqual(s.favoriteAuthor, { name: "Zero", count: 1 });
  assert.deepEqual(s.topTag, { tag: "sky", rate: 1 });
  assert.equal(s.spanDays, 0); // 单条 = 同一天
  assert.equal(s.activePhase, "深夜"); // 21 点
  assert.equal(s.topWeekday, "周一"); // 2026-09-14
});

test("profileSummary：无名作者 / 无标签返回 null；跨度与峰值从数据推导；画师并列取字典序靠前", () => {
  const rows = [
    item({ key: "a", title: "a", author: "  ", savedAt: at(2026, 8, 10, 1) }),
    item({ key: "b", title: "b", author: "", savedAt: at(2026, 8, 13, 2) }),
    item({ key: "c", title: "c", author: "beta", savedAt: at(2026, 8, 20, 2) }),
    item({ key: "d", title: "d", author: "alpha", savedAt: at(2026, 8, 24, 2) }),
  ];
  const s = profileSummary(rows);
  assert.deepEqual(s.favoriteAuthor, { name: "alpha", count: 1 }); // 并列 1:1，alpha < beta
  assert.equal(s.topTag, null); // 全程没有标签
  assert.equal(s.spanDays, 14); // 09-10 → 09-24
  assert.equal(s.activePhase, "凌晨"); // 1/2/2/2 点的峰值落在凌晨
  // 09-10(周四) 09-13(周日) 09-20(周日) 09-24(周四)：并列 2:2，取靠前的周四
  assert.equal(s.topWeekday, "周四");
});

test("profileSummary：活跃相位 / 周几由直方图峰值（而非首条）决定", () => {
  const rows = [
    item({ key: "a", title: "a", author: "x", savedAt: at(2026, 8, 1, 9) }), // 周二 上午
    item({ key: "b", title: "b", author: "x", savedAt: at(2026, 8, 5, 23) }), // 周六 深夜
    item({ key: "c", title: "c", author: "x", savedAt: at(2026, 8, 12, 23) }), // 周六 深夜
  ];
  const s = profileSummary(rows);
  assert.equal(s.activePhase, "深夜");
  assert.equal(s.topWeekday, "周六");
});

test("profileSummary：心头好按 authorKey 簇计数，装饰变体不再分票（画师整理）", () => {
  const rows = [
    item({ key: "a", title: "a", author: "☆あいす★", authorId: "", savedAt: at(2026, 8, 1, 10) }),
    item({ key: "b", title: "b", author: "あいす", authorId: "", savedAt: at(2026, 8, 2, 10) }),
    item({ key: "c", title: "c", author: "別人", authorId: "", savedAt: at(2026, 8, 3, 10) }),
  ];
  // 旧口径会把「☆あいす★」「あいす」记成两位各 1 票、并列时字典序取「あいす」；
  // 簇口径归一成 2 票，心头好是归一后的「あいす」
  assert.deepEqual(profileSummary(rows).favoriteAuthor, { name: "あいす", count: 2 });
  // 用户别名改写展示名，计数不变
  assert.deepEqual(profileSummary(rows, { あいす: "アイス" }).favoriteAuthor, { name: "アイス", count: 2 });
  // 同 authorId 双名称也归一；展示名取簇内最新 raw 的规范化
  const renamed = [
    item({ key: "d", title: "d", author: "user", authorId: "7", savedAt: at(2026, 8, 1, 10) }),
    item({ key: "e", title: "e", author: "☆user★@pixiv", authorId: "7", savedAt: at(2026, 8, 9, 10) }),
  ];
  assert.deepEqual(profileSummary(renamed).favoriteAuthor, { name: "user", count: 2 });
});

// ── 回顾三件套（今日去年 / 年度报告 / 随手翻一张）────────────────────

test("onThisDay：月-日相同且年份早于今年才命中，按年份降序分组", () => {
  const now = at(2026, 8, 14, 12); // 2026-09-14
  const rows = [
    item({ key: "last-year", title: "ly", author: "x", savedAt: at(2025, 8, 14, 10) }),
    item({ key: "before-last", title: "bly", author: "x", savedAt: at(2024, 8, 14, 9) }),
    item({ key: "before-last-2", title: "bly2", author: "x", savedAt: at(2024, 8, 14, 20) }),
    item({ key: "today", title: "t", author: "x", savedAt: at(2026, 8, 14, 8) }), // 今年 → 排除
    item({ key: "off-day", title: "o", author: "x", savedAt: at(2025, 8, 13, 8) }), // 月-日不同 → 排除
    item({ key: "future", title: "f", author: "x", savedAt: at(2027, 8, 14, 8) }), // 未来脏数据 → 排除
  ];
  const groups = onThisDay(rows, now);
  assert.deepEqual(groups.map((g) => g.year), [2025, 2024]);
  assert.deepEqual(groups[0].items.map((i) => i.key), ["last-year"]);
  assert.deepEqual(groups[1].items.map((i) => i.key), ["before-last", "before-last-2"]);
  assert.deepEqual(onThisDay([], now), []);
});

test("onThisDay：闰日 2-29 只在闰年的今天命中；平年 2-28 不捡漏", () => {
  const rows = [
    item({ key: "leap-2024", title: "l", author: "x", savedAt: at(2024, 1, 29, 10) }),
    item({ key: "feb-28", title: "f", author: "x", savedAt: at(2025, 1, 28, 10) }),
  ];
  // 平年 2-28：2-29 的条目不命中，2-28 的条目是同年（2025）不参与 → 空
  assert.deepEqual(onThisDay(rows, at(2025, 1, 28, 12)), []);
  // 闰年 2-29：2024 的闰日命中
  const hit = onThisDay(rows, at(2028, 1, 29, 12));
  assert.deepEqual(hit.map((g) => g.year), [2024]);
  assert.deepEqual(hit[0].items.map((i) => i.key), ["leap-2024"]);
});

test("filterByYear / vaultYears：本地年份切片、覆盖年份降序、无命中空数组", () => {
  const rows = [
    item({ key: "a", title: "a", author: "x", savedAt: at(2025, 0, 5, 10) }),
    item({ key: "b", title: "b", author: "x", savedAt: at(2026, 5, 1, 10) }),
    item({ key: "c", title: "c", author: "x", savedAt: at(2026, 11, 30, 10) }),
    item({ key: "d", title: "d", author: "x", savedAt: at(2024, 11, 31, 10) }),
  ];
  assert.deepEqual(vaultYears(rows), [2026, 2025, 2024]);
  assert.deepEqual(filterByYear(rows, 2026).map((r) => r.key), ["b", "c"]);
  assert.deepEqual(filterByYear(rows, 2020), []);
  assert.deepEqual(vaultYears([]), []);
});

test("reportNarrative：之最 / 节奏 / 心头好占比 / 跨度全从切片推导；空切片返回 null", () => {
  const rows: VaultMeta[] = [
    item({ key: "a", title: "薄春", author: "青", savedAt: at(2025, 2, 2, 23), tags: ["spring"], bytes: 100, pageCount: 1 }),
    item({ key: "b", title: "厚夏", author: "青", savedAt: at(2025, 2, 9, 23), tags: ["spring", "sea"], bytes: 900, pageCount: 6 }),
    item({ key: "c", title: "中秋", author: "白", savedAt: at(2025, 8, 14, 23), tags: ["spring", "sea"], bytes: 300, pageCount: 2 }),
  ];
  const n = reportNarrative(filterByYear(rows, 2025), 2025)!;
  assert.equal(n.total, 3);
  assert.deepEqual(n.peakMonth, { label: "3 月", count: 2 }); // 3 月两张，并列取最早
  assert.deepEqual(n.topAuthors[0], { name: "青", count: 2, pct: 67 }); // 簇口径 + 整数占比
  assert.deepEqual(n.topTags.map((t) => t.tag), ["spring", "sea"]);
  assert.equal(n.activePhase, "深夜"); // 三张都是 23 点
  assert.equal(n.topWeekday, "周日"); // 2025-03-02 / 03-09 / 09-14 都是周日
  assert.deepEqual(n.largestByBytes, { title: "厚夏", bytes: 900 });
  assert.deepEqual(n.largestByPages, { title: "厚夏", pageCount: 6 });
  assert.deepEqual(n.span, { days: 196, firstAt: at(2025, 2, 2, 23), lastAt: at(2025, 8, 14, 23) });
  assert.ok(n.closing?.includes("spring")); // 有标签 → 标签句
  assert.equal(reportNarrative([], 2025), null);
});

test("reportNarrative：单条年份的边界——页数之最不足两页为 null、跨度 0 天、无标签落到画师句", () => {
  const rows = [item({ key: "only", title: "独", author: "夜", savedAt: at(2024, 4, 5, 8), tags: [], bytes: 50, pageCount: 1 })];
  const n = reportNarrative(filterByYear(rows, 2024), 2024)!;
  assert.equal(n.total, 1);
  assert.deepEqual(n.peakMonth, { label: "5 月", count: 1 });
  assert.deepEqual(n.topAuthors, [{ name: "夜", count: 1, pct: 100 }]);
  assert.deepEqual(n.largestByBytes, { title: "独", bytes: 50 });
  assert.equal(n.largestByPages, null); // 只有单页 → 宁缺不编
  assert.equal(n.span.days, 0);
  assert.deepEqual(n.topTags, []);
  assert.ok(n.closing?.includes("夜")); // 无标签 → 画师句
});

test("reportNarrative：无名无标签无字节——心头好 / 标签 / 之最 / 结束语全空（宁缺不编）", () => {
  const rows = [
    item({ key: "a", title: "a", author: " ", savedAt: at(2025, 3, 1, 10), bytes: 0, pageCount: 1 }),
    item({ key: "b", title: "b", author: "", savedAt: at(2025, 3, 2, 10), bytes: 0, pageCount: 1 }),
  ];
  const n = reportNarrative(filterByYear(rows, 2025), 2025)!;
  assert.deepEqual(n.topAuthors, []);
  assert.deepEqual(n.topTags, []);
  assert.equal(n.largestByBytes, null); // 字节全 0
  assert.equal(n.largestByPages, null);
  assert.equal(n.closing, null); // 两样都读不出 → 不编结束语
  assert.equal(n.span.days, 1);
});

test("tagCloud：标签别名归一聚合，变体并成规范名合并计数（标签整理）", () => {
  const rows = [
    item({ key: "a", title: "a", author: "x", tags: ["鳴潮"] }),
    item({ key: "b", title: "b", author: "x", tags: ["WutheringWaves", "sky"] }),
    item({ key: "c", title: "c", author: "x", tags: ["鸣潮"] }),
  ];
  const tagAliases = { 鳴潮: "鸣潮", WutheringWaves: "鸣潮" };
  // 合并后「鸣潮」3 次、sky 1 次：max=3 定 5 档、count=1 定 1 档
  const chips = tagCloud(rows, { tagAliases });
  assert.deepEqual(
    chips.map((c) => [c.tag, c.count, c.scale]),
    [
      ["鸣潮", 3, 5],
      ["sky", 1, 1],
    ],
  );
  // 不带别名表 → 恒等映射，旧口径原样（同频字典序）
  assert.deepEqual(tagCloud(rows).map((c) => c.tag), ["WutheringWaves", "sky", "鳴潮", "鸣潮"]);
});

test("reportNarrative：兴趣坐标 Top 5 过标签别名，结束语用归一后的规范名（标签整理）", () => {
  const rows: VaultMeta[] = [
    item({ key: "a", title: "a", author: "青", savedAt: at(2025, 2, 2, 23), tags: ["鳴潮"] }),
    item({ key: "b", title: "b", author: "青", savedAt: at(2025, 2, 9, 23), tags: ["WutheringWaves", "海"] }),
    item({ key: "c", title: "c", author: "白", savedAt: at(2025, 8, 14, 23), tags: ["鸣潮"] }),
  ];
  const n = reportNarrative(filterByYear(rows, 2025), 2025, undefined, { 鳴潮: "鸣潮", WutheringWaves: "鸣潮" })!;
  assert.deepEqual(
    n.topTags.map((t) => [t.tag, t.count]),
    [
      ["鸣潮", 3],
      ["海", 1],
    ],
  );
  assert.ok(n.closing?.includes("「鸣潮」")); // 结束语跟随归一口径
});

test("pickRandom：rng 决定命中、翻不出封面的条目跳过、空池返回 null", () => {
  const rows = [
    item({ key: "cover-server", title: "a", author: "x", hasFile: true }),
    item({ key: "cover-app", title: "b", author: "x", origin: "app" }),
    item({ key: "cover-folder", title: "c", author: "x", origin: "folder", relativePath: "x/y.png" }),
    item({ key: "coverless", title: "d", author: "x", origin: "folder" }), // 文件夹副本已不可读
  ];
  assert.equal(pickRandom(rows, () => 0)?.key, "cover-server");
  assert.equal(pickRandom(rows, () => 0.5)?.key, "cover-app"); // floor(0.5 × 3) = 1
  assert.equal(pickRandom(rows, () => 0.99)?.key, "cover-folder"); // floor(0.99 × 3) = 2
  assert.equal(pickRandom([rows[3]], () => 0), null); // 池里只剩翻不出的
  assert.equal(pickRandom([]), null);
});
