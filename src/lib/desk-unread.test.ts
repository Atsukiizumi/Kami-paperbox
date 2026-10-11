import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_DAYS, type HistoryEntry } from "./view-history.ts";
import type { VaultMeta } from "./types.ts";
import { unreadItems, workKey } from "./desk-unread.ts";

const DAY = 24 * 60 * 60_000;

function meta(over: Partial<VaultMeta> & Pick<VaultMeta, "id" | "savedAt">): VaultMeta {
  return {
    key: `pixiv:${over.id}`,
    source: "pixiv",
    title: over.id,
    author: "a",
    authorId: "",
    tags: [],
    pageCount: 1,
    bytes: 1,
    ...over,
  };
}

function hist(over: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "viewedAt">): HistoryEntry {
  return {
    source: "pixiv",
    title: over.id,
    author: "",
    authorId: "",
    thumb: "",
    pageCount: 1,
    ...over,
  };
}

test("workKey 是 source:id", () => {
  assert.equal(workKey("yande", "9"), "yande:9");
});

test("从未打开且在 90 天内 → 未读", () => {
  const now = Date.UTC(2026, 8, 16);
  const got = unreadItems([meta({ id: "1", savedAt: now - 3 * DAY })], [], now);
  assert.equal(got.length, 1);
  assert.equal(got[0]?.id, "1");
});

test("打开晚于收藏 → 已读", () => {
  const now = Date.UTC(2026, 8, 16);
  const savedAt = now - 2 * DAY;
  const got = unreadItems(
    [meta({ id: "1", savedAt })],
    [hist({ id: "1", viewedAt: savedAt + 1000 })],
    now,
  );
  assert.equal(got.length, 0);
});

test("打开早于收藏 → 未读", () => {
  const now = Date.UTC(2026, 8, 16);
  const savedAt = now - 2 * DAY;
  const got = unreadItems(
    [meta({ id: "1", savedAt })],
    [hist({ id: "1", viewedAt: savedAt - 1000 })],
    now,
  );
  assert.equal(got.length, 1);
});

test("viewedAt 等于 savedAt → 已读", () => {
  const now = Date.UTC(2026, 8, 16);
  const savedAt = now - DAY;
  const got = unreadItems(
    [meta({ id: "1", savedAt })],
    [hist({ id: "1", viewedAt: savedAt })],
    now,
  );
  assert.equal(got.length, 0);
});

test("刚好在 90 天边界上（savedAt === cutoff）→ 未读", () => {
  const now = Date.UTC(2026, 8, 16);
  const cut = now - HISTORY_DAYS * DAY;
  const got = unreadItems([meta({ id: "1", savedAt: cut })], [], now);
  assert.equal(got.length, 1);
});

test("早于 90 天窗 → 未知，不进纸叠", () => {
  const now = Date.UTC(2026, 8, 16);
  const cut = now - HISTORY_DAYS * DAY;
  const got = unreadItems([meta({ id: "1", savedAt: cut - 1 })], [], now);
  assert.equal(got.length, 0);
});

test("空库空历史 → []；历史有键但匣里没有 → []", () => {
  const now = Date.UTC(2026, 8, 16);
  assert.deepEqual(unreadItems([], [], now), []);
  assert.deepEqual(unreadItems([], [hist({ id: "9", viewedAt: now })], now), []);
});

test("lastPage 水位不进未读口径（M3 不变量：只看 viewedAt vs savedAt）", () => {
  const now = Date.UTC(2026, 8, 16);
  const savedAt = now - 2 * DAY;
  // 打开晚于收藏、翻到第 3 页：已读，水位多少都一样
  assert.equal(
    unreadItems([meta({ id: "1", savedAt })], [hist({ id: "1", viewedAt: savedAt + 1000, lastPage: 2 })], now).length,
    0,
  );
  // 打开早于收藏、水位翻到很后面：照样未读
  assert.equal(
    unreadItems([meta({ id: "2", savedAt })], [hist({ id: "2", viewedAt: savedAt - 1000, lastPage: 50 })], now).length,
    1,
  );
});
