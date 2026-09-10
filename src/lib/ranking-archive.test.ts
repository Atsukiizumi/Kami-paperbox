import assert from "node:assert/strict";
import { test } from "node:test";
import { jstYesterdayCompact, pixivRankingDateParam } from "./ranking-archive.ts";

test("omits pixiv ranking date for today and the future", () => {
  const now = new Date("2026-09-08T04:00:00+08:00");
  assert.equal(pixivRankingDateParam("2026-09-08", now), undefined);
  assert.equal(pixivRankingDateParam("2026-09-09", now), undefined);
  assert.equal(pixivRankingDateParam("2026-09-07", now), "20260907");
});

// ── 日榜回落（JST 昨天） ─────────────────────────────────────────────────────

test("jstYesterdayCompact：东京时区跨月/跨年正确", () => {
  // JST 2026-09-10 01:00（UTC 前一天 16:00）→ 昨天 = 2026-09-09
  assert.equal(jstYesterdayCompact(new Date("2026-09-09T16:00:00Z")), "20260909");
  // JST 每月 1 号 → 上月末（2026-09-01 JST → 20260831）
  assert.equal(jstYesterdayCompact(new Date("2026-08-31T16:00:00Z")), "20260831");
  // JST 1 月 1 号 → 上一年末
  assert.equal(jstYesterdayCompact(new Date("2025-12-31T16:00:00Z")), "20251231");
});
