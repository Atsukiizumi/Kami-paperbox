import assert from "node:assert/strict";
import { test } from "node:test";
import { clampQueueConcurrency, MAX_QUEUE_ATTEMPTS, queueBackoffMs, queueShouldRetry } from "./queue-retry.ts";

test("backoff grows exponentially and caps at 30s", () => {
  assert.equal(queueBackoffMs(1), 4_000);
  assert.equal(queueBackoffMs(2), 8_000);
  assert.equal(queueBackoffMs(3), 16_000);
  assert.equal(queueBackoffMs(9), 30_000);
  assert.equal(queueBackoffMs(0), 4_000);
});

test("user-actionable errors are not retried", () => {
  assert.equal(queueShouldRetry("需要登录 Pixiv 才能查看该榜单。"), false);
  assert.equal(queueShouldRetry("需要有效订阅才能保存这篇投稿"), false);
  assert.equal(queueShouldRetry("该作品不可用"), false);
  assert.equal(queueShouldRetry("已开启安全模式，R-18 作品被隐藏。可在设置中关闭。"), false);
  assert.equal(queueShouldRetry("返回类型异常"), false);
  assert.equal(queueShouldRetry("源站暂时拒绝访问，请稍后再试"), true);
  assert.equal(queueShouldRetry("Yande 请求失败（503）"), true);
  assert.equal(queueShouldRetry("保存失败"), true);
});

test("concurrency clamps to 1..4 integers", () => {
  assert.equal(clampQueueConcurrency(1), 1);
  assert.equal(clampQueueConcurrency(3), 3);
  assert.equal(clampQueueConcurrency(4), 4);
  assert.equal(clampQueueConcurrency(9), 4);
  assert.equal(clampQueueConcurrency(0), 1);
  assert.equal(clampQueueConcurrency(-2), 1);
  assert.equal(clampQueueConcurrency(2.9), 2);
  assert.equal(clampQueueConcurrency(undefined), 1);
  assert.equal(clampQueueConcurrency("3"), 1);
  assert.ok(MAX_QUEUE_ATTEMPTS >= 2);
});
