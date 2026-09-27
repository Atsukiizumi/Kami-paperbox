import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalTag,
  displayTag,
  emptySavedTags,
  isTagTranslated,
  parseSavedTags,
  splitSearchTags,
  tagEquals,
  toggleSavedTag,
} from "./site-tags.ts";

describe("site tags", () => {
  it("keeps pixiv / fanbox wording and collapses spaces", () => {
    assert.equal(canonicalTag("pixiv", "  初音ミク  "), "初音ミク");
    assert.equal(canonicalTag("pixiv", "VOCALOID  初音"), "VOCALOID 初音");
    assert.equal(canonicalTag("fanbox", "風景 多余"), "風景");
    assert.equal(displayTag("pixiv", "初音ミク"), "初音ミク");
  });

  it("normalizes booru tags to underscore AND-queries", () => {
    assert.equal(canonicalTag("yande", "Hatsune Miku"), "hatsune miku");
    assert.equal(canonicalTag("yande", "hatsune_miku"), "hatsune_miku");
    assert.equal(canonicalTag("danbooru", " landscape, sky "), "landscape sky");
    assert.equal(displayTag("yande", "hatsune_miku"), "初音未来");
    assert.equal(displayTag("yande", "landscape sky"), "风景 · 天空");
    assert.equal(tagEquals("yande", "Hatsune_Miku", "hatsune_miku"), true);
  });

  it("splits quoted tags and commas", () => {
    assert.deepEqual(splitSearchTags('东方 "永江衣玖"'), ["东方", "永江衣玖"]);
    assert.deepEqual(splitSearchTags("landscape, sky"), ["landscape", "sky"]);
  });

  it("pins tags per list and drops duplicates", () => {
    const once = toggleSavedTag([], "pixiv", "猫");
    assert.deepEqual(once, ["猫"]);
    assert.deepEqual(toggleSavedTag(once, "pixiv", "猫"), []);
    const two = toggleSavedTag(once, "pixiv", "犬");
    assert.deepEqual(two, ["犬", "猫"]);
  });

  it("parses persisted saved-tag maps", () => {
    const parsed = parseSavedTags({
      pixiv: ["猫", "猫", ""],
      yande: ["Hatsune_Miku", 1],
      unknown: ["nope"],
    });
    assert.deepEqual(parsed.pixiv, ["猫"]);
    assert.deepEqual(parsed.yande, ["hatsune_miku"]);
    assert.deepEqual(parsed.fanbox, []);
    assert.deepEqual(parseSavedTags(null).konachan, emptySavedTags().konachan);
  });

  it("isTagTranslated：注入 map，booru 全命中 true / 有 miss false", () => {
    const map = new Map([
      ["hatsune_miku", "初音未来"],
      ["long_hair", "长发"],
    ]);
    assert.equal(isTagTranslated("danbooru", "hatsune_miku", map), true);
    assert.equal(isTagTranslated("yande", "long_hair", map), true);
    assert.equal(isTagTranslated("danbooru", "megami_magazine", map), false);
    // 多 token 混合：一个 miss 即整体未翻（与 displayTag 逐 token 同链）
    assert.equal(isTagTranslated("konachan", "long_hair megami_magazine", map), false);
  });

  it("isTagTranslated：pixiv / fanbox 恒 true（永不标记，PRD 边界）", () => {
    const map = new Map([["hatsune_miku", "初音未来"]]);
    assert.equal(isTagTranslated("pixiv", "初音ミク", map), true);
    assert.equal(isTagTranslated("pixiv", "totally_unknown", map), true);
    assert.equal(isTagTranslated("fanbox", "unknown_tag", map), true);
  });

  it("isTagTranslated：空 tag true；CJK token 不算未翻（非词表域）", () => {
    const map = new Map([["long_hair", "长发"]]);
    assert.equal(isTagTranslated("danbooru", "", map), true);
    assert.equal(isTagTranslated("danbooru", "鳴潮", map), true);
    assert.equal(isTagTranslated("danbooru", "long_hair 鳴潮", map), true);
  });

  it("isTagTranslated：缺省 map 走 currentLexiconMap（内置词表）", () => {
    assert.equal(isTagTranslated("danbooru", "long_hair"), true); // BUILTIN 命中
    assert.equal(isTagTranslated("danbooru", "megami_magazine"), false); // BUILTIN 无此词
  });
});
