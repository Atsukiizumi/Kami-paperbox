import assert from "node:assert/strict";
import { test } from "node:test";
import { BATCH_MAX, filterBatchable, workKeyOf } from "./batch-collect.ts";
import type { WorkCard } from "./types.ts";

function card(id: string): WorkCard {
  return { source: "pixiv", id, title: `t${id}`, author: "a", authorId: "1", thumb: "", pageCount: 1, tags: [] };
}

test("workKeyOf 形状与队列/纸匣索引一致", () => {
  assert.equal(workKeyOf(card("9")), "pixiv:9");
});

test("filterBatchable：已在纸匣/队列的跳过并计数", () => {
  const cards = [card("1"), card("2"), card("3"), card("4")];
  const out = filterBatchable(cards, {
    inVaultKeys: new Set(["pixiv:1"]),
    inQueueKeys: new Set(["pixiv:3"]),
  });
  assert.deepEqual(out.batchable.map((c) => c.id), ["2", "4"]);
  assert.equal(out.skippedVault, 1);
  assert.equal(out.skippedQueue, 1);
});

test("全在纸匣 → batchable 空", () => {
  const out = filterBatchable([card("1")], { inVaultKeys: new Set(["pixiv:1"]), inQueueKeys: new Set() });
  assert.equal(out.batchable.length, 0);
  assert.equal(out.skippedVault, 1);
});

test("BATCH_MAX 常量为 200", () => {
  assert.equal(BATCH_MAX, 200);
});
