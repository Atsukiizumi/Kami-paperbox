import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openRankingStore } from "./ranking-store.server.ts";

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
