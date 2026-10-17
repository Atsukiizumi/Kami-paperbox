import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSource, siteLabel, workOriginUrl, xHandleFromAuthor } from "./sites.ts";

test("work origin urls", () => {
  assert.equal(workOriginUrl("pixiv", "123"), "https://www.pixiv.net/artworks/123");
  assert.equal(workOriginUrl("fanbox", "99", "name"), "https://name.fanbox.cc/posts/99");
  assert.equal(workOriginUrl("yande", "1"), "https://yande.re/post/show/1");
  assert.equal(workOriginUrl("konachan", "2"), "https://konachan.com/post/show/2");
  assert.equal(workOriginUrl("danbooru", "3"), "https://danbooru.donmai.us/posts/3");
});

test("x 站点：siteLabel 显式 X；原推链接第三参收 handle，restId/空值退 intent 链", () => {
  assert.equal(siteLabel("x"), "X");
  assert.equal(workOriginUrl("x", "123", "artist_ai"), "https://x.com/artist_ai/status/123");
  // Work.authorId 是 restId（纯数字身份键）：不是 handle 形态，退 intent 链（X 会 302 到规范地址）
  assert.equal(workOriginUrl("x", "123", "22220000"), "https://x.com/i/web/status/123");
  assert.equal(workOriginUrl("x", "123"), "https://x.com/i/web/status/123");
});

test("xHandleFromAuthor：取 author（「显示名@handle」）里最后一个 handle", () => {
  assert.equal(xHandleFromAuthor("画師アイ@artist_ai"), "artist_ai");
  assert.equal(xHandleFromAuthor("名字@pixiv 手柄@artist_x"), "artist_x");
  assert.equal(xHandleFromAuthor("没有尾巴"), undefined);
  assert.equal(xHandleFromAuthor(""), undefined);
});

test("parseSource falls back to pixiv", () => {
  assert.equal(parseSource("fanbox"), "fanbox");
  assert.equal(parseSource("nope"), "pixiv");
});
