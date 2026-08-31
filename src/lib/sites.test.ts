import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSource, workOriginUrl } from "./sites.ts";

test("work origin urls", () => {
  assert.equal(workOriginUrl("pixiv", "123"), "https://www.pixiv.net/artworks/123");
  assert.equal(workOriginUrl("fanbox", "99", "name"), "https://name.fanbox.cc/posts/99");
  assert.equal(workOriginUrl("yande", "1"), "https://yande.re/post/show/1");
  assert.equal(workOriginUrl("konachan", "2"), "https://konachan.com/post/show/2");
  assert.equal(workOriginUrl("danbooru", "3"), "https://danbooru.donmai.us/posts/3");
});

test("parseSource falls back to pixiv", () => {
  assert.equal(parseSource("fanbox"), "fanbox");
  assert.equal(parseSource("nope"), "pixiv");
});
