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
  passPixivDisplayFilters,
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

  it("detects Pixiv AI works from aiType (只有 2=AI；0/1 都是非 AI) and tags", () => {
    assert.equal(isAiWork({ aiType: 2 }), true);
    assert.equal(isAiWork({ aiType: 1 }), false);
    assert.equal(isAiWork({ aiType: 0 }), false);
    assert.equal(isAiWork({}), false);
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

describe("passPixivDisplayFilters（发现流原始批的展示层原地筛）", () => {
  it("两档独立：R-18 按 xRestrict、AI 按 aiType/词表兜底", () => {
    const plain = { xRestrict: 0, aiType: 0, tags: [] };
    const r18 = { xRestrict: 1, aiType: 0, tags: [] };
    const ai = { xRestrict: 0, aiType: 2, tags: [] };
    const aiR18 = { xRestrict: 1, aiType: 2, tags: [] };
    const nonAiExplicit = { xRestrict: 0, aiType: 1, tags: [] };
    const aiByTag = { xRestrict: 0, aiType: 0, tags: ["AI-generated"] };
    // 两档全关：原样通过（aiType=1 是「非 AI」显式值，照常放行）
    for (const w of [plain, r18, ai, aiR18, nonAiExplicit, aiByTag]) {
      assert.equal(passPixivDisplayFilters(w, false, false), true);
    }
    // 只开 R-18 档：拦 R-18，AI 放行
    assert.equal(passPixivDisplayFilters(r18, true, false), false);
    assert.equal(passPixivDisplayFilters(ai, true, false), true);
    // 只开 AI 档：拦 AI（2 / 词表兜底），非 AI 与 R-18 放行
    assert.equal(passPixivDisplayFilters(ai, false, true), false);
    assert.equal(passPixivDisplayFilters(aiByTag, false, true), false);
    assert.equal(passPixivDisplayFilters(nonAiExplicit, false, true), true);
    assert.equal(passPixivDisplayFilters(r18, false, true), true);
    // 两档全开：都拦
    assert.equal(passPixivDisplayFilters(r18, true, true), false);
    assert.equal(passPixivDisplayFilters(ai, true, true), false);
    assert.equal(passPixivDisplayFilters(plain, true, true), true);
    // 缺字段（旧数据）不误伤
    assert.equal(passPixivDisplayFilters({}, true, true), true);
  });
});
