import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { effectiveConcurrency, noteRateLimit, rateLimitError, resetRateLimitCoolDown, RATE_LIMIT_COOL_DOWN_MS } from "./queue-throttle.ts";

beforeEach(() => resetRateLimitCoolDown());

test("rateLimitError 判定", () => {
  assert.equal(rateLimitError("第 3/40 页：下载失败（429）"), true);
  assert.equal(rateLimitError("下载失败（503）"), true);
  assert.equal(rateLimitError("上游风控"), true);
  assert.equal(rateLimitError("需要登录 Pixiv"), false);
  assert.equal(rateLimitError("下载失败（403）"), false);
});

test("冷却窗内降 2 档下限 1；到期恢复设置值", () => {
  noteRateLimit(1_000); // coolDownUntil = 1000 + 90_000
  assert.equal(effectiveConcurrency(4, 1_000 + 1), 2, "4 → 2");
  assert.equal(effectiveConcurrency(3, 1_000 + 1), 1, "3 → 1（下限）");
  assert.equal(effectiveConcurrency(2, 1_000 + 1), 1, "2 → 1");
  assert.equal(effectiveConcurrency(1, 1_000 + 1), 1, "1 → 1");
  assert.equal(effectiveConcurrency(4, 1_000 + RATE_LIMIT_COOL_DOWN_MS), 4, "到期恢复");
  // 未 note 过：原样
  resetRateLimitCoolDown();
  assert.equal(effectiveConcurrency(3, 999_999), 3);
});
