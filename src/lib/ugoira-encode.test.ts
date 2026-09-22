/**
 * X5：Worker 包装的回退契约。node/jsdom 无 createImageBitmap，字节级等价
 * 无法在离线测试里锁（encode 本就是浏览器路径）——这里锁「无 Worker 时回退
 * 委托主线程 encode（错误原样透传）」；真 Worker 与字节等价由 e2e/手验覆盖。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeUgoiraGifViaWorker } from "./ugoira-encode.ts";

test("无 Worker 环境：回退主线程路径，encode 的错误原样透传", async () => {
  assert.equal(typeof globalThis.Worker, "undefined", "本测试前提：环境无 Worker");
  await assert.rejects(encodeUgoiraGifViaWorker([], { maxEdge: 64 }), /没有可编码的帧/);
});
