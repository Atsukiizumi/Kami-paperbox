/**
 * motion-runtime 行为测试（动效批 2026-10-25 · Task 1）。
 *
 * 作用：锁「关闭 / 取消 / 播放中关闭」三条收尾路径的对外行为。
 * 用法：node --import tsx --test src/lib/motion-runtime.test.ts。
 * 为什么：运行时的价值全在生命周期保证上——native finished 会 reject、
 *   无限动画 finish() 会抛错这些坑，不用 Animation double 逐条钉住必回潮。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAnimateUi,
  cancelOwnedAnimations,
  commitOwnedMotion,
  hasOwnedAnimations,
  playOwnedMotion,
  readMotionTiming,
  setUiMotionEnabled,
} from "./motion-runtime.ts";

type Double = {
  finished: Promise<unknown>;
  playState: string;
  calls: { finish: number; cancel: number; commitStyles: number };
  resolveFinished: (value?: unknown) => void;
  rejectFinished: (reason?: unknown) => void;
  finish(): void;
  cancel(): void;
  commitStyles(): void;
};

/** 局部 Animation double：只在测试里模拟 WAAPI 动画，不进生产代码。 */
function makeAnimDouble(opts?: { infinite?: boolean; noCommit?: boolean }): Double {
  let resolveFinished!: (value?: unknown) => void;
  let rejectFinished!: (reason?: unknown) => void;
  const finished = new Promise((resolve: (value?: unknown) => void, reject: (reason?: unknown) => void) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const double: Double = {
    finished,
    playState: "running",
    calls: { finish: 0, cancel: 0, commitStyles: 0 },
    resolveFinished: (value?: unknown) => resolveFinished(value),
    rejectFinished: (reason?: unknown) => rejectFinished(reason),
    finish() {
      double.calls.finish++;
      if (opts?.infinite) throw new Error("Animation finish() on infinite animation");
      double.playState = "finished";
      resolveFinished();
    },
    cancel() {
      double.calls.cancel++;
      double.playState = "idle";
      rejectFinished(new Error("Animation was cancelled"));
    },
    commitStyles() {
      double.calls.commitStyles++;
      if (opts?.noCommit) throw new Error("commitStyles unsupported");
    },
  };
  return double;
}

function playWithDouble(el: HTMLElement, double: Double, onFinish?: () => void) {
  el.animate = (() => double) as unknown as typeof el.animate;
  return playOwnedMotion(
    el,
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 150, fill: "both" },
    onFinish,
  );
}

// 顺序执行：第一条先锁「水合前策略未明不起播」，之后每条自设策略。

test("unknown policy (before hydration) does not play and runs onFinish synchronously", async () => {
  assert.equal(canAnimateUi(), false);
  let completed = 0;
  const el = document.createElement("div");
  el.animate = () => {
    throw new Error("unknown policy must not animate");
  };
  const handle = playOwnedMotion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 }, () => completed++);
  assert.equal(completed, 1);
  assert.equal(await handle.finished, "disabled");
  handle.finish();
  assert.equal(completed, 1);
});

test("disabled policy does not animate, onFinish runs once, finish is a no-op", async () => {
  setUiMotionEnabled(false);
  assert.equal(canAnimateUi(), false);
  let completed = 0;
  const el = document.createElement("div");
  el.animate = () => {
    throw new Error("disabled must not animate");
  };
  const handle = playOwnedMotion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 }, () => completed++);
  assert.equal(completed, 1);
  assert.equal(await handle.finished, "disabled");
  handle.finish();
  assert.equal(completed, 1);
});

test("natural finish commits the end frame, cancels the native animation and clears will-change", async () => {
  setUiMotionEnabled(true);
  const el = document.createElement("div");
  el.style.willChange = "transform, opacity";
  let completed = 0;
  const double = makeAnimDouble();
  const handle = playWithDouble(el, double, () => completed++);
  assert.equal(hasOwnedAnimations(el), true);
  double.resolveFinished();
  assert.equal(await handle.finished, "finished");
  assert.equal(completed, 1);
  assert.equal(double.calls.commitStyles, 1);
  assert.equal(double.calls.cancel, 1);
  assert.equal(el.style.willChange, "");
  assert.equal(hasOwnedAnimations(el), false);
});

test("native finished rejection (cancel) resolves the handle as cancelled without onFinish", async () => {
  const el = document.createElement("div");
  let completed = 0;
  const double = makeAnimDouble();
  const handle = playWithDouble(el, double, () => completed++);
  double.rejectFinished(new Error("aborted"));
  assert.equal(await handle.finished, "cancelled");
  assert.equal(completed, 0);
  assert.equal(hasOwnedAnimations(el), false);
});

test("handle.cancel() cancels the native animation without onFinish", async () => {
  const el = document.createElement("div");
  let completed = 0;
  const double = makeAnimDouble();
  const handle = playWithDouble(el, double, () => completed++);
  handle.cancel();
  assert.equal(await handle.finished, "cancelled");
  assert.equal(double.calls.cancel, 1);
  assert.equal(completed, 0);
});

test("switching motion off mid-play jumps registered handles to their end state", async () => {
  const el = document.createElement("div");
  let completed = 0;
  const double = makeAnimDouble();
  const handle = playWithDouble(el, double, () => completed++);
  setUiMotionEnabled(false);
  assert.equal(await handle.finished, "finished");
  assert.equal(completed, 1);
  assert.equal(double.calls.finish, 1);
  assert.equal(double.calls.commitStyles, 1);
  assert.equal(double.calls.cancel, 1);
  assert.equal(el.style.willChange, "");
  // 新起播立即落到 disabled 分支
  const next = playOwnedMotion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  assert.equal(await next.finished, "disabled");
});

test("switching off leaves unregistered animations alone", async () => {
  setUiMotionEnabled(true);
  const el = document.createElement("div");
  const stranger = makeAnimDouble();
  void stranger.finished.catch(() => undefined);
  el.animate = (() => stranger) as unknown as typeof el.animate;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  setUiMotionEnabled(false);
  assert.equal(stranger.calls.cancel, 0);
  assert.equal(stranger.playState, "running");
  stranger.cancel();
});

test("handle.finish() on an infinite animation falls back to the underlying static state", async () => {
  setUiMotionEnabled(true);
  const el = document.createElement("div");
  let completed = 0;
  const double = makeAnimDouble({ infinite: true });
  el.animate = (() => double) as unknown as typeof el.animate;
  const handle = playOwnedMotion(
    el,
    [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(0,-8px,0)" }],
    { duration: 2800, iterations: Infinity },
    () => completed++,
  );
  handle.finish();
  assert.equal(await handle.finished, "finished");
  assert.equal(completed, 1);
  assert.equal(double.calls.finish, 1);
  // 无限动画 finish() 抛错 → 不 commitStyles，直接 cancel 落回底层静态
  assert.equal(double.calls.commitStyles, 0);
  assert.equal(double.calls.cancel, 1);
});

test("commitOwnedMotion snapshots the visual inline and cancels only owned animations", async () => {
  const el = document.createElement("div");
  el.style.transform = "matrix(1, 0, 0, 1, 4, 5)";
  el.style.opacity = "0.6";
  const double = makeAnimDouble();
  const handle = playWithDouble(el, double);
  const visual = commitOwnedMotion(el);
  assert.equal(visual.transform, "matrix(1, 0, 0, 1, 4, 5)");
  assert.equal(visual.opacity, 0.6);
  assert.equal(await handle.finished, "cancelled");
  assert.equal(double.calls.cancel, 1);
  // 快照写进了行内，供改向动画的起始帧衔接
  assert.equal(el.style.transform, "matrix(1, 0, 0, 1, 4, 5)");
  assert.equal(el.style.opacity, "0.6");
});

test("cancelOwnedAnimations releases the element registry", async () => {
  const el = document.createElement("div");
  const double = makeAnimDouble();
  const handle = playWithDouble(el, double);
  cancelOwnedAnimations(el);
  assert.equal(await handle.finished, "cancelled");
  assert.equal(hasOwnedAnimations(el), false);
});

test("commitStyles fallback writes the computed transform/opacity inline", async () => {
  const el = document.createElement("div");
  el.style.transform = "matrix(2, 0, 0, 2, 10, 10)";
  const double = makeAnimDouble({ noCommit: true });
  el.animate = (() => double) as unknown as typeof el.animate;
  const handle = playOwnedMotion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  double.resolveFinished();
  assert.equal(await handle.finished, "finished");
  assert.equal(double.calls.commitStyles, 1);
  assert.equal(el.style.transform, "matrix(2, 0, 0, 2, 10, 10)");
});

test("readMotionTiming parses seconds and milliseconds and keeps the token easing", () => {
  const el = document.createElement("div");
  el.style.setProperty("--motion-quick", "0.15s");
  el.style.setProperty("--ease-out", "cubic-bezier(0.22, 1, 0.36, 1)");
  const quick = readMotionTiming(el, "quick");
  assert.equal(quick.duration, 150);
  assert.equal(quick.easing, "cubic-bezier(0.22, 1, 0.36, 1)");

  el.style.setProperty("--motion-fast", "250ms");
  assert.equal(readMotionTiming(el, "fast").duration, 250);

  const fallback = readMotionTiming(el, "layer");
  assert.equal(fallback.duration, 220);
  assert.equal(fallback.easing, "cubic-bezier(0.22, 1, 0.36, 1)");
});
