import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hourHistogram,
  hourPhaseName,
  peakBucket,
  profileSummary,
  sourceComposition,
  tagCloud,
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
