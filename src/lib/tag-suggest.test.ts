import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySuggest,
  mergeSuggestLists,
  parseBooruSuggest,
  parsePixivSuggest,
  shouldSuggest,
  suggestPrefix,
} from "./tag-suggest.ts";

test("suggestPrefix uses the last token except on FANBOX", () => {
  assert.equal(suggestPrefix("pixiv", "初音 ミ"), "ミ");
  assert.equal(suggestPrefix("yande", "hatsune mi"), "mi");
  assert.equal(suggestPrefix("fanbox", "風景 忽略"), "風景 忽略");
});

test("applySuggest replaces the last token and appends after a space", () => {
  assert.equal(applySuggest("pixiv", "初音", "初音ミク"), "初音ミク");
  assert.equal(applySuggest("pixiv", "东方 ", "永江衣玖"), "东方 永江衣玖");
  assert.equal(applySuggest("yande", "hatsune mi", "miku"), "hatsune miku");
});

test("shouldSuggest skips URLs", () => {
  assert.equal(shouldSuggest("初音"), true);
  assert.equal(shouldSuggest("https://www.pixiv.net/artworks/1"), false);
});

test("parsePixivSuggest reads ajax tags and cps candidates", () => {
  const ajax = parsePixivSuggest({
    body: { tags: [{ tag: "初音ミク", tag_translation: "Hatsune Miku" }, "VOCALOID"] },
  });
  assert.equal(ajax[0]?.tag, "初音ミク");
  assert.equal(ajax[0]?.extra, "Hatsune Miku");
  const cps = parsePixivSuggest({ candidates: [{ tag_name: "鏡音リン", access_count: "12000" }] });
  assert.equal(cps[0]?.tag, "鏡音リン");
  assert.equal(cps[0]?.extra, "12k");
});

test("parseBooruSuggest skips blocked tags", () => {
  const items = parseBooruSuggest("yande", [
    { name: "hatsune_miku", count: 9 },
    { name: "loli", count: 99 },
  ]);
  assert.deepEqual(items.map((i) => i.tag), ["hatsune_miku"]);
});

test("mergeSuggestLists pins saved before recents and drops dupes", () => {
  const items = mergeSuggestLists(
    ["初音ミク"],
    ["初音ミク", "鏡音リン"],
    [{ tag: "巡音ルカ", extra: "1k" }, { tag: "鏡音リン" }],
  );
  assert.deepEqual(
    items.map((i) => [i.tag, i.extra]),
    [
      ["初音ミク", "已保存"],
      ["鏡音リン", "最近"],
      ["巡音ルカ", "1k"],
    ],
  );
});
