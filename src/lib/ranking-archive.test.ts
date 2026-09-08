import assert from "node:assert/strict";
import { test } from "node:test";
import { pixivRankingDateParam } from "./ranking-archive.ts";

test("omits pixiv ranking date for today and the future", () => {
  const now = new Date("2026-09-08T04:00:00+08:00");
  assert.equal(pixivRankingDateParam("2026-09-08", now), undefined);
  assert.equal(pixivRankingDateParam("2026-09-09", now), undefined);
  assert.equal(pixivRankingDateParam("2026-09-07", now), "20260907");
});
