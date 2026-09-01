import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageThumbUrls } from "./page-thumbs.ts";

describe("pageThumbUrls", () => {
  it("keeps a single cover", () => {
    assert.deepEqual(pageThumbUrls("https://i.pximg.net/c/250x250/img-master/img/a_p0_square1200.jpg", 1), [
      "https://i.pximg.net/c/250x250/img-master/img/a_p0_square1200.jpg",
    ]);
  });

  it("walks pixiv _p0_ to the next pages", () => {
    const urls = pageThumbUrls(
      "https://i.pximg.net/c/250x250/img-master/img/2024/01/02/03/04/05/99_p0_square1200.jpg",
      8,
      3,
    );
    assert.equal(urls.length, 3);
    assert.match(urls[1] ?? "", /_p1_square1200/);
    assert.match(urls[2] ?? "", /_p2_square1200/);
    assert.equal(urls[0]?.includes("_p0_"), true);
  });

  it("does not invent pages when the url has no _p0_", () => {
    assert.equal(pageThumbUrls("https://yande.re/data/preview/ab.jpg", 4).length, 1);
  });
});
