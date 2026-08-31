import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectPixivTags,
  collectIllustRecords,
  collectOrderedIds,
  formatRankDate,
  isAiWork,
  isLastFeedPage,
  isPixivRankMode,
  orderCardsByIds,
  pixivAiType,
  rankingMeta,
} from "./pixiv-feed.ts";

describe("pixiv feed", () => {
  it("knows ranking modes and which need login / nsfw", () => {
    assert.equal(isPixivRankMode("rookie"), true);
    assert.equal(isPixivRankMode("recommend"), false);
    assert.equal(rankingMeta("daily_r18").nsfw, true);
    assert.equal(rankingMeta("daily_r18").login, true);
    assert.equal(rankingMeta("original").nsfw, false);
    assert.equal(formatRankDate("20260826"), "2026-08-26");
  });

  it("reads discovery / follow thumbnail lists", () => {
    const recs = collectIllustRecords({
      body: {
        thumbnails: {
          illust: [
            { id: "1", title: "a" },
            { id: "2", title: "b" },
          ],
        },
        recommendedIllusts: [{ illustId: "2" }, { illustId: "1" }],
        page: { ids: [2, 1], isLastPage: false },
      },
    });
    assert.equal(recs.length, 2);
    assert.deepEqual(collectOrderedIds({ body: { page: { ids: [2, 1] } } }), ["2", "1"]);
    assert.deepEqual(
      orderCardsByIds(
        [
          { id: "1" },
          { id: "2" },
        ],
        ["2", "1"],
      ).map((c) => c.id),
      ["2", "1"],
    );
    assert.equal(isLastFeedPage({ body: { page: { isLastPage: true } } }, 60), true);
  });

  it("falls back to illusts array", () => {
    const recs = collectIllustRecords({ body: { illusts: [{ id: "9" }] } });
    assert.equal(recs[0]?.id, "9");
  });

  it("detects Pixiv AI works from aiType and tags", () => {
    assert.equal(isAiWork({ aiType: 2 }), true);
    assert.equal(isAiWork({ aiType: 1 }), false);
    assert.equal(isAiWork({ tags: ["AI生成"] }), true);
    assert.equal(isAiWork({ tags: ["风景"] }), false);
    assert.equal(pixivAiType({ illust_ai_type: "2" }), 2);
    assert.equal(pixivAiType({ aiType: 1 }), 1);
  });

  it("reads tags from nested illust json and from a flat array", () => {
    assert.deepEqual(
      collectPixivTags({
        tags: {
          tags: [{ tag: "オリジナル" }, { tag: "VOCALOID" }, { tag: "オリジナル" }],
        },
      }),
      ["オリジナル", "VOCALOID"],
    );
    assert.deepEqual(collectPixivTags({ tags: [{ tag: "猫" }, "風景"] }), ["猫", "風景"]);
    assert.deepEqual(collectPixivTags(["hatsune_miku", "VOCALOID"]), ["hatsune_miku", "VOCALOID"]);
  });
});
