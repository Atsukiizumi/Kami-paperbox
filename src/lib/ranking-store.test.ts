import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openRankingStore } from "./storage/ranking-store.server.ts";

describe("ranking store", () => {
  it("writes and lists a daily snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "kami-rank-"));
    const store = openRankingStore(dir);
    try {
      store.put("yande", "daily", "2026-09-08", [
        {
          source: "yande",
          id: "1",
          title: "a",
          author: "b",
          authorId: "",
          thumb: "",
          pageCount: 1,
          tags: [],
        },
      ]);
      const list = store.list("yande", "daily");
      assert.equal(list[0]?.date, "2026-09-08");
      assert.equal(store.get(list[0]!.id)?.items[0]?.id, "1");
    } finally {
      // Windows 上 sqlite 句柄不关就删目录会 EPERM。
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TD-31 rankings retention", () => {
  it("per (site, period) keeps only the latest 60 snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "kami-rank-ret-"));
    const store = openRankingStore(dir);
    try {
      for (let i = 1; i <= 65; i += 1) {
        store.put("pixiv", "daily", `2026-08-${String(i).padStart(2, "0")}`, []);
      }
      const list = store.list("pixiv", "daily");
      assert.equal(list.length, 60);
      const dates = list.map((m) => m.date);
      assert.equal(dates.includes("2026-08-01"), false);
      assert.equal(dates.includes("2026-08-02"), false);
      assert.equal(dates.includes("2026-08-65".replace("65", "05")), false); // 08-05 也已清
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
