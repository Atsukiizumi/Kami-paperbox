import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUserInput } from "./parse-input.ts";

describe("parseUserInput", () => {
  it("reads yande.re post and tag links", () => {
    assert.deepEqual(parseUserInput("https://yande.re/post/show/1267938", "pixiv"), {
      kind: "booru-post",
      site: "yande",
      id: "1267938",
    });
    const tags = parseUserInput("https://yande.re/post?tags=landscape+sky", "pixiv");
    assert.equal(tags.kind, "booru-tag");
    if (tags.kind === "booru-tag") {
      assert.equal(tags.site, "yande");
      assert.equal(tags.word.includes("landscape"), true);
    }
    assert.deepEqual(parseUserInput("https://yande.re/pool/show/99384", "pixiv"), {
      kind: "booru-pool",
      site: "yande",
      id: "99384",
    });
  });

  it("reads konachan and danbooru posts", () => {
    assert.deepEqual(parseUserInput("https://konachan.com/post/show/407742", "yande"), {
      kind: "booru-post",
      site: "konachan",
      id: "407742",
    });
    assert.deepEqual(parseUserInput("https://danbooru.donmai.us/posts/12081224", "pixiv"), {
      kind: "booru-post",
      site: "danbooru",
      id: "12081224",
    });
  });

  it("treats numeric ids on booru tab as posts", () => {
    assert.deepEqual(parseUserInput("99", "yande"), {
      kind: "booru-post",
      site: "yande",
      id: "99",
    });
  });

  it("searches FANBOX tags vs creator ids", () => {
    assert.deepEqual(parseUserInput("official", "fanbox"), {
      kind: "fanbox-creator",
      id: "official",
    });
    assert.deepEqual(parseUserInput("風景", "fanbox"), {
      kind: "fanbox-tag",
      word: "風景",
    });
  });
});
