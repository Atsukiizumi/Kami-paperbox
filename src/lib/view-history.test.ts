import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HISTORY_DAYS,
  parseAuthorHistory,
  parseHistoryItems,
  pruneHistory,
  upsertAuthorHistory,
  upsertHistory,
  type AuthorHistoryEntry,
  type HistoryEntry,
} from "./view-history.ts";

function entry(id: string, viewedAt = 1): HistoryEntry {
  return {
    source: "pixiv",
    id,
    title: id,
    author: "a",
    authorId: "1",
    thumb: "",
    pageCount: 1,
    viewedAt,
  };
}

function author(id: string, viewedAt = 1, extra: Partial<AuthorHistoryEntry> = {}): AuthorHistoryEntry {
  return { source: "pixiv", id, name: id, avatar: "", viewedAt, ...extra };
}

describe("view history", () => {
  it("moves a revisited work to the front", () => {
    const now = Date.now();
    const items = upsertHistory([entry("1", now - 2), entry("2", now - 1)], entry("1", now));
    assert.equal(items[0]?.id, "1");
    assert.equal(items[0]?.viewedAt, now);
    assert.equal(items.length, 2);
  });

  it("drops works older than the retention window", () => {
    const now = Date.now();
    const keep = entry("new", now);
    const drop = entry("old", now - (HISTORY_DAYS + 1) * 24 * 60 * 60_000);
    const items = pruneHistory([keep, drop], now);
    assert.deepEqual(items.map((row) => row.id), ["new"]);
  });

  it("drops broken persisted rows", () => {
    const items = parseHistoryItems([{ source: "pixiv", id: "1", title: "ok" }, { source: "nope", id: "2" }, null]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.title, "ok");
  });

  it("keeps an existing avatar when a later visit has none", () => {
    const first = upsertAuthorHistory([], author("9", 1, { name: "猫屋", avatar: "https://i.pximg.net/a.jpg" }));
    const next = upsertAuthorHistory(first, author("9", 2, { name: "猫屋", avatar: "" }));
    assert.equal(next[0]?.avatar, "https://i.pximg.net/a.jpg");
    assert.equal(next[0]?.viewedAt, 2);
  });

  it("drops unknown author sources", () => {
    const items = parseAuthorHistory([{ source: "pixiv", id: "1", name: "a" }, { source: "yande", id: "2" }]);
    assert.equal(items.length, 1);
  });
});
