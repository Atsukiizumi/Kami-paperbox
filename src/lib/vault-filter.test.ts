import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorOption } from "./storage/vault-query.ts";
import {
  applySlipClear,
  clearVaultFilter,
  EMPTY_VAULT_FILTER,
  filterAuthorOptions,
  VAULT_TAG_VISIBLE,
  vaultFilterSlips,
  visibleVaultTags,
  type VaultFilterState,
} from "./vault-filter.ts";

const base: VaultFilterState = { ...EMPTY_VAULT_FILTER };

test("无条件 → 无笺；N 用 slips.length", () => {
  assert.deepEqual(vaultFilterSlips(base, { authorName: "" }), []);
});

test("笺顺序：站点、作者、各标签、月份、未读、今日去年、AI、R-18", () => {
  const slips = vaultFilterSlips(
    {
      source: "pixiv",
      authorKey: "pixiv:1",
      tags: ["猫", "原创"],
      month: "2026-09",
      unreadOnly: true,
      recallOnly: true,
      ai: true,
      r18: true,
    },
    { authorName: "画师A" },
  );
  assert.deepEqual(
    slips.map((s) => [s.kind, s.label]),
    [
      ["source", "Pixiv"],
      ["author", "画师A"],
      ["tag", "猫"],
      ["tag", "原创"],
      ["month", "2026-09"],
      ["unread", "未读"],
      ["recall", "今日去年"],
      ["ai", "AI 作画"],
      ["r18", "R-18"],
    ],
  );
});

test("点笺清掉对应条件，其它不动", () => {
  const state: VaultFilterState = {
    source: "yande",
    authorKey: "a",
    tags: ["x", "y"],
    month: "2026-01",
    unreadOnly: true,
    recallOnly: true,
    ai: true,
    r18: true,
  };
  assert.equal(applySlipClear(state, { kind: "source", key: "yande", label: "Yande" }).source, "all");
  assert.equal(applySlipClear(state, { kind: "author", key: "a", label: "n" }).authorKey, "");
  assert.deepEqual(applySlipClear(state, { kind: "tag", key: "x", label: "x" }).tags, ["y"]);
  assert.equal(applySlipClear(state, { kind: "month", key: "2026-01", label: "2026-01" }).month, "");
  assert.equal(applySlipClear(state, { kind: "unread", key: "unread", label: "未读" }).unreadOnly, false);
  assert.equal(applySlipClear(state, { kind: "recall", key: "recall", label: "今日去年" }).recallOnly, false);
  assert.equal(applySlipClear(state, { kind: "ai", key: "ai", label: "AI 作画" }).ai, false);
  assert.equal(applySlipClear(state, { kind: "r18", key: "r18", label: "R-18" }).r18, false);
});

test("清空筛选复位八项", () => {
  assert.deepEqual(
    clearVaultFilter({
      source: "pixiv",
      authorKey: "k",
      tags: ["t"],
      month: "2026-09",
      unreadOnly: true,
      recallOnly: true,
      ai: true,
      r18: true,
    }),
    EMPTY_VAULT_FILTER,
  );
});

test("visibleVaultTags：空搜索已选优先且补到 40；有搜索不截断", () => {
  const freq = Array.from({ length: 50 }, (_, i) => `t${i}`);
  const selected = ["t49", "extra"];
  const closed = visibleVaultTags(freq, selected, "");
  assert.equal(closed[0], "t49");
  assert.equal(closed[1], "extra");
  assert.equal(closed.length, VAULT_TAG_VISIBLE);
  assert.ok(closed.includes("t0"));
  const q = visibleVaultTags(freq, selected, "T4");
  assert.ok(q.includes("t4") && q.includes("t40") && q.includes("t49"));
  assert.equal(q.length, freq.filter((t) => t.toLowerCase().includes("t4")).length);
});

test("filterAuthorOptions 按展示名", () => {
  const opts: AuthorOption[] = [
    { key: "1", name: "Alice", count: 2 },
    { key: "2", name: "阿布", count: 1 },
  ];
  assert.equal(filterAuthorOptions(opts, "").length, 2);
  assert.deepEqual(filterAuthorOptions(opts, "alice").map((o) => o.key), ["1"]);
  assert.equal(filterAuthorOptions(opts, "不存在").length, 0);
});
