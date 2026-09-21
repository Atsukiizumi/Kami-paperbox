import assert from "node:assert/strict";
import { test } from "node:test";
import { clampWatchLimit, diffNewCount, parseWatchArtists, parseWatchTags, tagWatchKey } from "./watch.ts";

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
