import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchOk, WorkCard } from "./types.ts";
import { DESK_PREVIEW_LIMIT, previewItems } from "./desk-preview.ts";

function card(id: string): WorkCard {
  return {
    source: "pixiv",
    id,
    title: id,
    author: "a",
    authorId: "",
    thumb: `/t/${id}`,
    pageCount: 1,
    tags: [],
  };
}

test("空 / 错 op → []", () => {
  assert.deepEqual(previewItems(undefined), []);
  assert.deepEqual(previewItems({ op: "pixivRelated", items: [card("1")] } as FetchOk), []);
  assert.deepEqual(
    previewItems({ op: "pixivMyFollowing", items: [{ id: "1", name: "n", avatar: "" }], nextPage: null }),
    [],
  );
});

test("推荐 / 最新 / FANBOX 首页截到 8 张，空封面丢掉", () => {
  const items = Array.from({ length: 10 }, (_, i) => card(String(i + 1)));
  assert.equal(previewItems({ op: "pixivRecommend", items, nextPage: null }).length, DESK_PREVIEW_LIMIT);
  assert.equal(previewItems({ op: "booruList", site: "yande", items, nextPage: null })[0]?.id, "1");
  assert.equal(previewItems({ op: "fanboxHome", items: items.slice(0, 3), cursor: null }).length, 3);
  const mixed = [card("1"), { ...card("2"), thumb: "" }, card("3")];
  assert.deepEqual(
    previewItems({ op: "pixivRecommend", items: mixed, nextPage: null }).map((x) => x.id),
    ["1", "3"],
  );
});
