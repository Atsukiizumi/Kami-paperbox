/**
 * stepKbFocus 单测（P2-d）：J/K 跨页判定的六条规则锁。
 * browse 接线三行走手测（AC 的「单测锁」由本文件满足，design §3.2）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { stepKbFocus } from "./kb-paging.ts";

const pager = { hasPrev: true, hasNext: true };

test("页内步进：next 焦点 +1、prev 焦点 -1；next 无焦点落首卡", () => {
  assert.deepEqual(stepKbFocus("next", 0, { length: 3 }, pager), { kind: "focus", index: 1 });
  assert.deepEqual(stepKbFocus("prev", 2, { length: 3 }, pager), { kind: "focus", index: 1 });
  assert.deepEqual(stepKbFocus("next", null, { length: 3 }, pager), { kind: "focus", index: 0 });
});

test("页尾按 J 且 hasNext → 翻下页落页首", () => {
  assert.deepEqual(stepKbFocus("next", 2, { length: 3 }, pager), { kind: "page", delta: 1, landAt: "head" });
});

test("页尾按 J 无 hasNext → clamp 末卡不翻", () => {
  assert.deepEqual(stepKbFocus("next", 2, { length: 3 }, { hasPrev: true, hasNext: false }), {
    kind: "focus",
    index: 2,
  });
});

test("页首按 K 且 hasPrev → 翻上页落末卡", () => {
  assert.deepEqual(stepKbFocus("prev", 0, { length: 3 }, pager), { kind: "page", delta: -1, landAt: "tail" });
});

test("无焦点按 K → noop（现状行为不变）", () => {
  assert.deepEqual(stepKbFocus("prev", null, { length: 3 }, pager), { kind: "noop" });
});

test("空列表两方向都 noop", () => {
  assert.deepEqual(stepKbFocus("next", null, { length: 0 }, pager), { kind: "noop" });
  assert.deepEqual(stepKbFocus("prev", 0, { length: 0 }, pager), { kind: "noop" });
});
