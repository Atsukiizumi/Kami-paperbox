import assert from "node:assert/strict";
import { test } from "node:test";
import { clampWatchLimit, daysSince, diffNewCount, isTagSubscribed, parseWatchArtists, parseWatchTags, tagWatchKey, WATCH_STALE_DAYS } from "./watch.ts";

const good = {
  source: "pixiv",
  id: "11",
  name: "画师",
  avatar: "https://i.pximg.net/a.jpg",
  addedAt: 1_700_000_000_000,
};

test("parseWatchArtists 清洗：坏项丢弃、字段截断、超限截取", () => {
  const list = parseWatchArtists([
    good,
    { source: "danbooru", id: "x" }, // 非 watch source
    { source: "pixiv", id: "" }, // 空 id
    "junk",
    { source: "pixiv", id: "22", name: "x".repeat(200), avatar: "javascript:alert(1)" },
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.name, "画师");
  assert.equal(list[1]!.name, "x".repeat(80));
  assert.equal(list[1]!.avatar, "");
  assert.equal(parseWatchArtists("nope").length, 0);
  assert.equal(parseWatchArtists(Array.from({ length: 300 }, () => good), 20).length, 20);
  assert.equal(parseWatchArtists(Array.from({ length: 300 }, () => good), 100).length, 100);
});

test("clampWatchLimit 夹取 20~500，默认 100", () => {
  assert.equal(clampWatchLimit(undefined), 100);
  assert.equal(clampWatchLimit(5), 20);
  assert.equal(clampWatchLimit(9999), 500);
  assert.equal(clampWatchLimit("x"), 100);
});

test("diffNewCount：水位之上计数，水位不在列表返回 0", () => {
  const items = [{ id: "3" }, { id: "2" }, { id: "1" }];
  assert.equal(diffNewCount(items, undefined), 0);
  assert.equal(diffNewCount(items, "1"), 2);
  assert.equal(diffNewCount(items, "3"), 0);
  assert.equal(diffNewCount(items, "99"), 0); // 水位消失（全部已读过后被冲掉）不虚报
});

// ── 标签订阅模型（09-21-tag-watch-vault-filter）──────────────────────────────

test("parseWatchTags：逐项校验、同站同词大小写归一去重、超限截取", () => {
  const tags = parseWatchTags([
    { source: "pixiv", tag: " 鳴潮 ", addedAt: 1 },
    { source: "pixiv", tag: "鳴潮", addedAt: 2 }, // 同站同词（trim/小写归一）→ 去重
    { source: "yande", tag: "Nagi", addedAt: 3 },
    { source: "yande", tag: "nagi", addedAt: 4 }, // 跨大小写同词 → 去重
    { source: "fanbox", tag: "x", addedAt: 5 }, // 站点不在白名单 → 丢
    { source: "pixiv", tag: "   ", addedAt: 6 }, // 空词 → 丢
    "junk", // 非对象 → 丢
    { source: "konachan", tag: "landscape", addedAt: 7, lastSeenId: "9", lastCheckedAt: 8 },
  ]);
  assert.deepEqual(
    tags.map((t) => [t.source, t.tag]),
    [
      ["pixiv", "鳴潮"],
      ["yande", "Nagi"],
      ["konachan", "landscape"],
    ],
  );
  assert.equal(tags[2]?.lastSeenId, "9");
  assert.equal(tags[2]?.lastCheckedAt, 8);
  assert.equal(parseWatchTags("nope").length, 0);
  // 上限 30 截取
  const many = Array.from({ length: 50 }, (_, i) => ({ source: "pixiv", tag: `t${i}`, addedAt: i }));
  assert.equal(parseWatchTags(many).length, 30);
});

test("tagWatchKey：站点 + 小写词", () => {
  assert.equal(tagWatchKey("yande", " Nagi "), "yande:nagi");
  assert.notEqual(tagWatchKey("pixiv", "nagi"), tagWatchKey("yande", "nagi"));
});

test("isTagSubscribed（P2-e 订阅钮已订阅态）：同键命中、大小写与空白不裂、异站不算", () => {
  const watchTags = [{ source: "pixiv" as const, tag: "鳴潮", addedAt: 1 }];
  assert.equal(isTagSubscribed(watchTags, "pixiv", "鳴潮"), true);
  assert.equal(isTagSubscribed(watchTags, "pixiv", " 鳴潮 "), true, "空白大小写不裂（tagWatchKey 归一）");
  assert.equal(isTagSubscribed(watchTags, "yande", "鳴潮"), false, "异站同词不算");
  assert.equal(isTagSubscribed([], "pixiv", "鳴潮"), false);
});

// ── 断更天数 daysSince（O，10-17-slideshow-stale-clean）──────────────────────

const NOW = new Date(2026, 9, 17, 12, 0); // 本地构造，任何时区跑都确定

/** 照 vault-profile.test.ts 的 at() 手法：本地墙上时间 → 带本机偏移的 ISO 串（偏移随串走，任何时区回读同一时刻）。 */
function isoAtLocal(date: Date): string {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

test("daysSince：89/90/91 天边界——>WATCH_STALE_DAYS 才灰（89/90 不灰、91 灰）", () => {
  assert.equal(WATCH_STALE_DAYS, 90);
  const at = (daysAgo: number) => daysSince(isoAtLocal(new Date(2026, 9, 17 - daysAgo, 12)), NOW);
  assert.equal(at(89), 89);
  assert.equal(at(89)! > WATCH_STALE_DAYS, false, "89 不灰");
  assert.equal(at(90), 90);
  assert.equal(at(90)! > WATCH_STALE_DAYS, false, "90 不超过 90，不灰");
  assert.equal(at(91), 91);
  assert.equal(at(91)! > WATCH_STALE_DAYS, true, "91 灰 +「N 天没更新了」");
});

test("daysSince：undefined / 空串 / 非法串 → null（渲染层出「—」态）", () => {
  assert.equal(daysSince(undefined, NOW), null);
  assert.equal(daysSince("", NOW), null);
  assert.equal(daysSince("oops", NOW), null);
});

test("daysSince：未来日期夹 0；带偏移 ISO 按本地日历日截断（同刻异偏移拼法同值）", () => {
  assert.equal(daysSince(isoAtLocal(new Date(2026, 9, 18, 12)), NOW), 0, "晚于 now 一天 → 夹 0 不出负数");
  // 同一时刻两种偏移拼法：UTC 串面日是 10-16、+09:00 墙面日是 10-17，天数必须一致——
  // 锁「按时刻的本地日历日，不吃串面日期」这个契约
  const utcSpelled = "2026-10-16T15:00:00Z";
  const jstSpelled = "2026-10-17T00:00:00+09:00";
  assert.equal(daysSince(utcSpelled, NOW), daysSince(jstSpelled, NOW));
  const instant = new Date(utcSpelled);
  const expected = Math.max(
    0,
    Math.round(
      (Date.UTC(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()) -
        Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate())) /
        86_400_000,
    ),
  );
  assert.equal(daysSince(jstSpelled, NOW), expected, "期望值 = 本地日历日差");
});
