import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldVeil, veilCoverClass } from "./veil.ts";
import type { WorkCard } from "./types.ts";

const w = (v: Partial<WorkCard> & { source: WorkCard["source"] }) => v as WorkCard;

test("shouldVeil：R-18 / booru nsfw rating / AI 三源判定", () => {
  assert.equal(shouldVeil(w({ source: "pixiv", xRestrict: 1 })), true);
  assert.equal(shouldVeil(w({ source: "pixiv", xRestrict: 2 })), true);
  assert.equal(shouldVeil(w({ source: "fanbox", tags: [] })), false, "普通作品不遮");
  assert.equal(shouldVeil(w({ source: "yande", rating: "e" })), true);
  assert.equal(shouldVeil(w({ source: "yande", rating: "s" })), false);
  assert.equal(shouldVeil(w({ source: "pixiv", aiType: 2 })), true, "AI 显式");
  assert.equal(shouldVeil(w({ source: "pixiv", tags: ["AI生成"] })), true, "AI 词表兜底");
  assert.equal(shouldVeil(w({ source: "yande" })), false, "rating 缺失（空串语义由补全保证）");
});

test("veilCoverClass：只有遮盖开着且该遮时才模糊", () => {
  const r18 = w({ source: "pixiv", xRestrict: 1 });
  const plain = w({ source: "pixiv", xRestrict: 0, tags: [] });
  assert.equal(veilCoverClass(true, r18), "blur-md select-none");
  assert.equal(veilCoverClass(false, r18), "");
  assert.equal(veilCoverClass(true, plain), "");
});
