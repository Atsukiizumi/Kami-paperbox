import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { coolDownDeadline, effectiveConcurrency, noteRateLimit, queueRetryDelayMs, rateLimitError, resetRateLimitCoolDown, RATE_LIMIT_COOL_DOWN_MS } from "./queue-throttle.ts";

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

test("F4 queueRetryDelayMs：限速对齐冷却截止，非限速退避不变", () => {
  const backoff = (a: number) => Math.min(4000 * 2 ** Math.max(0, a - 1), 30_000);
  noteRateLimit(1_000); // coolDownUntil = 91_000
  // 限速错误：attempts=1 退避 4s，冷却剩余 89_000+1s → 取 90_000
  assert.equal(queueRetryDelayMs("第 2/5 页：下载失败（429）", 1, 1_500, backoff), 90_500); // until 91_000，剩 89_500+1s
  // 续期取最新：note 到 5_000（until 95_000），now 5_500 → 剩 89_500+1s
  noteRateLimit(5_000);
  assert.equal(queueRetryDelayMs("下载失败（503）", 2, 5_500, backoff), 90_500);
  // 非限速：退避原样
  assert.equal(queueRetryDelayMs("网络断了", 2, 5_500, backoff), 8_000);
  // 冷却已过：限速也走退避
  assert.equal(queueRetryDelayMs("下载失败（429）", 1, 200_000, backoff), 4_000);
  // coolDownDeadline 只读 getter
  resetRateLimitCoolDown();
  assert.equal(coolDownDeadline(999_999), 0);
});
