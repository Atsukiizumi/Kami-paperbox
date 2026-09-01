import assert from "node:assert/strict";
import { test } from "node:test";
import { upgradeThumbUrl } from "./thumb-url.ts";

test("upgradeThumbUrl strips Pixiv crop and square1200", () => {
  const src =
    "https://i.pximg.net/c/250x250_80_a2/img-master/img/2024/01/01/00/00/00/1_p0_square1200.jpg";
  assert.equal(
    upgradeThumbUrl(src),
    "https://i.pximg.net/img-master/img/2024/01/01/00/00/00/1_p0_master1200.jpg",
  );
});

test("upgradeThumbUrl maps danbooru preview to sample", () => {
  assert.equal(
    upgradeThumbUrl("https://cdn.donmai.us/preview/ab/cd/hash.jpg"),
    "https://cdn.donmai.us/sample/ab/cd/hash.jpg",
  );
});
