import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchOk, WorkCard } from "./types.ts";
import { newspaperItems } from "./desk-newspaper.ts";

function card(id: string): WorkCard {
  return {
    source: "yande",
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
  assert.deepEqual(newspaperItems(undefined), []);
  const related = { op: "pixivRelated", items: [card("1")] } as FetchOk;
  assert.deepEqual(newspaperItems(related), []);
});

test("pixivRanking / booruList 截到 4 张", () => {
  const items = [card("1"), card("2"), card("3"), card("4"), card("5")];
  assert.deepEqual(
    newspaperItems({ op: "pixivRanking", date: "20260916", items, nextPage: null }).map((x) => x.id),
    ["1", "2", "3", "4"],
  );
  assert.equal(newspaperItems({ op: "booruList", site: "yande", items: items.slice(0, 2), nextPage: null }).length, 2);
});
