/**
 * 案头报纸数据抽整页测试（node --test，零依赖）。
 *
 * 作用：锁 rankingPageItems 的 op 判别（pixivRanking / booruList 给整页，
 *      其他 op / 空 / 未定义给空数组）——报纸 marquee 轨道与归档共用的入口。
 * 用法：node --experimental-strip-types --test src/lib/desk-newspaper.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchOk, WorkCard } from "./types.ts";
import { rankingPageItems } from "./desk-newspaper.ts";

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
  assert.deepEqual(rankingPageItems(undefined), []);
  const related = { op: "pixivRelated", items: [card("1")] } as FetchOk;
  assert.deepEqual(rankingPageItems(related), []);
});

test("pixivRanking / booruList 给整页不截断（轨道侧 cap 30 由组件负责）", () => {
  const items = [card("1"), card("2"), card("3"), card("4"), card("5")];
  const page: FetchOk = { op: "pixivRanking", date: "20260916", items, nextPage: null };
  assert.equal(rankingPageItems(page).length, 5);
  assert.equal(rankingPageItems(page), items);
  assert.equal(
    rankingPageItems({ op: "booruList", site: "yande", items: items.slice(0, 2), nextPage: null }).length,
    2,
  );
});
