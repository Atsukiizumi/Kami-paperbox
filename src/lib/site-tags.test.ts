import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalTag,
  displayTag,
  emptySavedTags,
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
    assert.equal(displayTag("yande", "hatsune_miku"), "hatsune miku");
    assert.equal(displayTag("yande", "landscape sky"), "landscape · sky");
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
});
