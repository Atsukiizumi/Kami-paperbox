import assert from "node:assert/strict";
import { test } from "node:test";
import { clampWatchLimit, diffNewCount, parseWatchArtists } from "./watch.ts";

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
