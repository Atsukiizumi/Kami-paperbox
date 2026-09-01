import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_LIMIT, parseHistoryItems, upsertHistory, type HistoryEntry } from "./view-history.ts";

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

describe("view history", () => {
  it("moves a revisited work to the front", () => {
    const items = upsertHistory([entry("1"), entry("2")], entry("1", 9));
    assert.equal(items[0]?.id, "1");
    assert.equal(items[0]?.viewedAt, 9);
    assert.equal(items.length, 2);
  });

  it("caps the list", () => {
    let items: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) items = upsertHistory(items, entry(String(i)));
    assert.equal(items.length, HISTORY_LIMIT);
    assert.equal(items[0]?.id, String(HISTORY_LIMIT + 4));
  });

  it("drops broken persisted rows", () => {
    const items = parseHistoryItems([{ source: "pixiv", id: "1", title: "ok" }, { source: "nope", id: "2" }, null]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.title, "ok");
  });
});
