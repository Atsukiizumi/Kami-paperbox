/**
 * F1 双作用域画布选择：node 环境（无 document）走 OffscreenCanvas 分支；
 * 两个都缺给明确错误。主线程（有 document）路径由既有 e2e/手验覆盖。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas2D } from "./ugoira.ts";

test("F1：无 document 时走 OffscreenCanvas；两者皆缺明确报错", () => {
  assert.equal(typeof globalThis.document, "undefined", "前提：node 无 DOM");
  // 皆缺：明确错误（不静默）
  assert.throws(() => createCanvas2D(4, 4), /无可用画布/);
  // 桩 OffscreenCanvas：走 worker 分支
  const calls: number[] = [];
  const fakeCtx = { clearRect: () => undefined, drawImage: () => undefined, getImageData: () => ({ data: new Uint8ClampedArray(4 * 4 * 4) }) };
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      calls.push(w, h);
    }
    getContext() {
      return fakeCtx;
    }
  }
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
  try {
    const ctx = createCanvas2D(6, 7);
    assert.deepEqual(calls, [6, 7], "尺寸传对");
    assert.equal(ctx, fakeCtx);
  } finally {
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
  }
});
