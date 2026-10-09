import assert from "node:assert/strict";
import { test } from "node:test";
import { BATCH_MAX } from "./batch-collect.ts";
import {
  applyEnqueueMany,
  formatBatchEnqueueToast,
  formatPoolEnqueueToast,
} from "./queue-cap.ts";
import type { QueueItem, QueueKind } from "./types.ts";

function draft(n: number, kind: QueueKind = "vault") {
  return {
    key: `pixiv:${n}`,
    source: "pixiv" as const,
    id: String(n),
    title: `t${n}`,
    author: "a",
    thumb: "",
    kind,
  };
}

function queued(
  n: number,
  status: QueueItem["status"] = "queued",
  kind: QueueKind = "download",
): QueueItem {
  return { ...draft(n, kind), status, progress: 0, total: 1, addedAt: 1 };
}

test("空批次不改队列", () => {
  const existing = [queued(1)];
  const out = applyEnqueueMany(existing, [], 9);
  assert.equal(out.items, existing);
  assert.deepEqual(out.tally, { kept: 0, dropped: 0 });
});

test("超过上限时留下后加入的 80 张，先加入的算作没排进", () => {
  const incoming = Array.from({ length: 100 }, (_, i) => draft(i + 1));
  const { items, tally } = applyEnqueueMany([], incoming, 5);
  assert.equal(BATCH_MAX, 80);
  assert.equal(items.length, 80);
  assert.deepEqual(tally, { kept: 80, dropped: 20 });
  assert.equal(items[0]?.key, "pixiv:100");
  assert.equal(items[79]?.key, "pixiv:21");
  assert.equal(items.some((x) => x.key === "pixiv:1"), false);
  assert.equal(items[0]?.addedAt, 5);
});

test("未超上限时全部留下，新的排在最前", () => {
  const { items, tally } = applyEnqueueMany([], [draft(1), draft(2), draft(3)], 2);
  assert.deepEqual(tally, { kept: 3, dropped: 0 });
  assert.deepEqual(items.map((x) => x.key), ["pixiv:3", "pixiv:2", "pixiv:1"]);
});

test("队列已满时，这次新加的仍算留下，挤掉的是队尾旧项", () => {
  const existing = Array.from({ length: 80 }, (_, i) => queued(1000 + i));
  const { items, tally } = applyEnqueueMany(existing, [1, 2, 3, 4, 5].map((n) => draft(n)), 4);
  assert.deepEqual(tally, { kept: 5, dropped: 0 });
  assert.equal(items.length, 80);
  assert.equal(items[0]?.key, "pixiv:5");
  assert.equal(items.some((x) => x.key === "pixiv:1079"), false);
  assert.equal(items.some((x) => x.key === "pixiv:1000"), true);
});

test("进行中的同一条不重复占位；下载会把纸匣任务改成下载", () => {
  const running = { ...queued(1, "running", "vault"), progress: 2, total: 4 };
  const same = applyEnqueueMany([running], [draft(1, "vault")], 3);
  assert.equal(same.items[0]?.status, "running");
  assert.equal(same.items[0]?.progress, 2);
  assert.deepEqual(same.tally, { kept: 1, dropped: 0 });

  const upgraded = applyEnqueueMany([queued(1, "queued", "vault")], [draft(1, "download")], 3);
  assert.equal(upgraded.items.length, 1);
  assert.equal(upgraded.items[0]?.kind, "download");
  assert.equal(upgraded.items[0]?.status, "queued");
});

test("同一批里的重复 key 只计一张", () => {
  const { items, tally } = applyEnqueueMany([], [draft(7), draft(7), draft(8)], 1);
  assert.equal(items.length, 2);
  assert.deepEqual(tally, { kept: 2, dropped: 0 });
});

test("已完成的同 key 会重新排队", () => {
  const { items, tally } = applyEnqueueMany([queued(1, "done")], [draft(1, "vault")], 8);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, "queued");
  assert.equal(items[0]?.kind, "vault");
  assert.equal(items[0]?.addedAt, 8);
  assert.deepEqual(tally, { kept: 1, dropped: 0 });
});

test("提示在没超出时保持原句，超出时写明留下的和没排进的", () => {
  assert.equal(formatBatchEnqueueToast("vault", { kept: 3, dropped: 0 }, []), "已入队：纸匣 3 张");
  assert.equal(
    formatBatchEnqueueToast("download", { kept: 3, dropped: 0 }, ["已在纸匣 1", "队列中 2"]),
    "已入队：下载 3 张（跳过 已在纸匣 1、队列中 2）",
  );
  assert.equal(
    formatBatchEnqueueToast("vault", { kept: 80, dropped: 40 }, ["队列中 2"]),
    "已入队：纸匣 80 张（队列只保留 80 张，这次有 40 张没排进去；跳过 队列中 2）",
  );
  assert.equal(formatPoolEnqueueToast("download", { kept: 12, dropped: 0 }), "已加入队列：下载合集 12 张");
  assert.equal(
    formatPoolEnqueueToast("vault", { kept: 80, dropped: 15 }),
    "已加入队列：收入纸匣 80 张（队列只保留 80 张，这次有 15 张没排进去）",
  );
});
