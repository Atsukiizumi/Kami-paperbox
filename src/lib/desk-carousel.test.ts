/**
 * 案头轮播纯函数测试（node --test，零依赖）。
 *
 * 作用：锁顺序切块丢尾、洗牌确定性（rigged rand 手算期望 + LCG 稳定性）、
 *      needsCarousel 边界、环形推进、墙的动态批量 clamp（含 2xl）、报纸 marquee
 *      单程时长、断点→批大小映射（铺纸 8/12、池深恒 3 批）。
 * 用法：node --experimental-strip-types --test src/lib/desk-carousel.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { artistWallSize, buildFrames, marqueeDurationMs, needsCarousel, nextFrame, sheetBatch } from "./desk-carousel.ts";

/** 32 位输出 [0,1) 的确定性 LCG；同一 seed 全程可复现。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("顺序模式按原顺序切块，尾块不足整块丢弃", () => {
  const ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.deepEqual(buildFrames(ten, 4), [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ]);
  assert.deepEqual(buildFrames(ten, 4, undefined, "sequential"), [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ]);
  // 8 张正好两块
  assert.deepEqual(buildFrames(ten.slice(0, 8), 4).length, 2);
  // size=1（铺纸）：一张一帧
  assert.deepEqual(buildFrames(["a", "b", "c"], 1), [["a"], ["b"], ["c"]]);
});

test("顺序模式边界：空池 / 池短于 size / 非法 size 都给空", () => {
  assert.deepEqual(buildFrames([], 4), []);
  assert.deepEqual(buildFrames(["a"], 4), []);
  assert.deepEqual(buildFrames(["a", "b"], 0), []);
  assert.deepEqual(buildFrames(["a", "b"], -1), []);
});

test("铺纸整批口径：size=8，24 张 3 批、20 张 2 批丢尾、15 张单批不轮播", () => {
  const pool = (n: number) => Array.from({ length: n }, (_, i) => i);
  const full = buildFrames(pool(24), 8);
  assert.equal(full.length, 3);
  assert.ok(full.every((batch) => batch.length === 8));
  assert.deepEqual(full[2], [16, 17, 18, 19, 20, 21, 22, 23]);
  // 20 张 → 2 批共 16 张，尾 4 张丢弃
  const dropped = buildFrames(pool(20), 8);
  assert.equal(dropped.length, 2);
  assert.equal(dropped.reduce((n, batch) => n + batch.length, 0), 16);
  // 15 张（<16 凑不齐两批）→ 单批，needsCarousel 判静态
  const single = buildFrames(pool(15), 8);
  assert.equal(single.length, 1);
  assert.equal(needsCarousel(single), false);
});

test("洗牌模式：rigged rand 下结果与手算一致", () => {
  const pool = ["a", "b", "c", "d", "e", "f"];
  // Fisher–Yates 从尾往前：i=5 用 0.999→j=5 不换；i=4 用 0→j=0 换头；
  // i=3 用 0.5→j=2；i=2 用 0.999→j=2 不换；i=1 用 0→j=0 换头。
  const seq = [0.999, 0.0, 0.5, 0.999, 0.0];
  let k = 0;
  const rigged = () => seq[k++] ?? 0;
  assert.deepEqual(buildFrames(pool, 2, rigged, "shuffle"), [
    ["b", "e"],
    ["d", "c"],
    ["a", "f"],
  ]);
});

test("洗牌模式：LCG 同 seed 稳定、不改原池、元素不丢不重", () => {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const a = buildFrames(pool, 5, lcg(20260916), "shuffle");
  const b = buildFrames(pool, 5, lcg(20260916), "shuffle");
  assert.deepEqual(a, b);
  // 原池保持升序未被洗牌污染
  assert.deepEqual(pool, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // 展平后是原池的一个排列
  assert.deepEqual(a.flat().sort((x, y) => x - y), pool);
  // 尾块不足整块同样丢弃：10 张 size=4 → 2 帧共 8 张
  assert.equal(buildFrames(pool, 4, lcg(7), "shuffle").length, 2);
});

test("needsCarousel：至少两帧才轮播", () => {
  assert.equal(needsCarousel(undefined), false);
  assert.equal(needsCarousel(null), false);
  assert.equal(needsCarousel([]), false);
  assert.equal(needsCarousel([["a"]]), false);
  assert.equal(needsCarousel([["a"], ["b"]]), true);
});

test("nextFrame 环形推进，len 异常兜底 0", () => {
  assert.equal(nextFrame(0, 3), 1);
  assert.equal(nextFrame(1, 3), 2);
  assert.equal(nextFrame(2, 3), 0);
  assert.equal(nextFrame(4, 1), 0);
  assert.equal(nextFrame(0, 0), 0);
});

test("artistWallSize：clamp(floor(len/3), 9, 12)", () => {
  assert.equal(artistWallSize(27), 9);
  assert.equal(artistWallSize(30), 10);
  assert.equal(artistWallSize(36), 12);
  assert.equal(artistWallSize(40), 12);
  // 池薄时压到下限 9（池 <9 张时 buildFrames 自然切不出帧，走静态）
  assert.equal(artistWallSize(15), 9);
  assert.equal(artistWallSize(26), 9);
  assert.equal(artistWallSize(0), 9);
});

test("artistWallSize 2xl：上限放宽到 16，池 36 时仍 12（4 列 × 3 行）", () => {
  assert.equal(artistWallSize(36, true), 12);
  assert.equal(artistWallSize(30, true), 10);
  // 更厚的池（假设池 cap 放开到 48）吃到 16 上限
  assert.equal(artistWallSize(48, true), 16);
  assert.equal(artistWallSize(54, true), 16);
  // 池薄同样压到下限 9；默认断点不受影响
  assert.equal(artistWallSize(15, true), 9);
  assert.equal(artistWallSize(0, true), 9);
  assert.equal(artistWallSize(36, false), 12);
});

test("sheetBatch：默认 8 格（4×2），2xl 12 格（6×2）；池深恒 3 批", () => {
  assert.equal(sheetBatch(false), 8);
  assert.equal(sheetBatch(true), 12);
  // 池 = 3 批：24 / 36
  assert.equal(sheetBatch(false) * 3, 24);
  assert.equal(sheetBatch(true) * 3, 36);
  // 2xl 下凑不满两批（<24）仍回落静态
  const thin = buildFrames(Array.from({ length: 23 }, (_, i) => i), sheetBatch(true));
  assert.equal(needsCarousel(thin), false);
  const full = buildFrames(Array.from({ length: 24 }, (_, i) => i), sheetBatch(true));
  assert.equal(needsCarousel(full), true);
});

test("marqueeDurationMs：张数 × 4s，池空 / 异常给 0 不排动画", () => {
  assert.equal(marqueeDurationMs(1), 4000);
  assert.equal(marqueeDurationMs(8), 32000);
  assert.equal(marqueeDurationMs(30), 120000);
  assert.equal(marqueeDurationMs(0), 0);
  assert.equal(marqueeDurationMs(-3), 0);
  assert.equal(marqueeDurationMs(Number.NaN), 0);
});
