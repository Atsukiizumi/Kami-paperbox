import assert from "node:assert/strict";
import { test } from "node:test";
import { clampQueueConcurrency, classifyQueueError, MAX_QUEUE_ATTEMPTS, queueBackoffMs, queueShouldRetry, retryableKeys } from "./queue-retry.ts";

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

// ── X2：失败分类与批量重试 ───────────────────────────────────────────────────

test("classifyQueueError 五类边界", () => {
  assert.equal(classifyQueueError("第 3/40 页：下载失败（429）"), "rate-limit");
  assert.equal(classifyQueueError("上游风控，稍后再试"), "rate-limit");
  assert.equal(classifyQueueError("先在设置里添加 Pixiv 账号"), "other", "不含「需要登录」字样");
  assert.equal(classifyQueueError("需要登录 Pixiv 才能查看"), "auth");
  assert.equal(classifyQueueError("需要有效订阅才能保存这篇投稿"), "auth");
  assert.equal(classifyQueueError("该投稿需要订阅"), "auth");
  assert.equal(classifyQueueError("内容不可用"), "unavailable");
  assert.equal(classifyQueueError("返回类型异常"), "unavailable");
  assert.equal(classifyQueueError("下载失败（fetch failed）"), "network");
  assert.equal(classifyQueueError("Pixiv 请求失败（502）"), "network");
  assert.equal(classifyQueueError("别的什么"), "other");
});

test("retryableKeys：只回炉可重试的失败项", () => {
  const items = [
    { key: "a", status: "error", error: "第 2/5 页：下载失败（429）" },
    { key: "b", status: "error", error: "需要登录 Pixiv" },
    { key: "c", status: "error", error: "网络断了" },
    { key: "d", status: "done" },
    { key: "e", status: "queued" },
    { key: "f", status: "error", error: undefined },
  ];
  assert.deepEqual(retryableKeys(items), ["a", "c"]);
});

test("F6 一致性：classify 每类错误与 queueShouldRetry 期望对齐（不存在判死）", () => {
  const samples: [string, ReturnType<typeof classifyQueueError>, boolean][] = [
    ["第 3/40 页：下载失败（429）", "rate-limit", true],
    ["上游风控", "rate-limit", true],
    ["需要登录 Pixiv 才能查看", "auth", false],
    ["需要有效订阅才能保存这篇投稿", "auth", false],
    ["内容不可用", "unavailable", false],
    ["作品不存在", "unavailable", false], // F6：上游真实错误串，判死不再白跑 3 次
    ["合集不存在", "unavailable", false],
    ["该投稿已被隐藏", "unavailable", false],
    ["返回类型异常", "unavailable", false],
    ["未知站点", "unavailable", false],
    ["下载失败（fetch failed）", "network", true],
    ["Pixiv 请求失败（502）", "network", true],
    ["下载失败（403）", "network", true], // 4xx 非 429 历史上可重试（服务端代理层语义），保持
    ["别的什么", "other", true],
  ];
  for (const [message, kind, shouldRetry] of samples) {
    assert.equal(classifyQueueError(message), kind, `classify(${message})`);
    assert.equal(queueShouldRetry(message), shouldRetry, `shouldRetry(${message})`);
  }
});
