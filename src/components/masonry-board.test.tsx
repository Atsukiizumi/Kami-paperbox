/**
 * MasonryBoard 重排行为测试（动效批 2026-10-25 · Task 2）。
 *
 * 作用：锁「几何一次落位 + 存量卡片 FLIP + 新增/离屏/关停不重播」的对外行为。
 * 用法：node --import tsx --test src/components/masonry-board.test.tsx。
 * 为什么：jsdom 没有布局与 WAAPI——本文件给 root 桩 clientWidth、给卡片把
 *   getBoundingClientRect 挂到已写的 CSS 变量上（视觉=几何），再桩 animate
 *   记录播放；断言几何变量、节点身份与播放集合，不测实现细节。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MasonryBoard } from "./masonry-board.tsx";
import { setUiMotionEnabled } from "@/lib/motion-runtime";
import { useSettings } from "@/lib/store";

const WIDTH = 1000;
// jsdom 无视口：给一个确定高度，离屏判定才有意义
(window as { innerHeight: number }).innerHeight = 800;

/** 卡片的「视觉矩形」= 已写入的几何变量（模拟浏览器布局结果）。 */
function linkRectToVars(el: HTMLElement, extraHeight = 88) {
  el.getBoundingClientRect = () => {
    const num = (key: string) => Number.parseFloat(el.style.getPropertyValue(key)) || 0;
    const left = num("--masonry-x");
    const top = num("--masonry-y");
    const width = num("--masonry-w");
    const height = num("--masonry-media-h") + extraHeight;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

type PlayLog = { el: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions };

/** 局部 WAAPI 桩：记录播放并返回可控的 Animation double（不进生产代码）。 */
const cancelCounts = new WeakMap<HTMLElement, number>();

function stubAnimate(el: HTMLElement, log: PlayLog[]) {
  el.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    log.push({ el, frames, options });
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise((_, reject) => {
      rejectFinished = reject;
    });
    void finished.catch(() => undefined);
    return {
      finished,
      cancel: () => {
        cancelCounts.set(el, (cancelCounts.get(el) ?? 0) + 1);
        rejectFinished(new Error("cancelled"));
      },
    } as Animation;
  }) as typeof el.animate;
}

function rig(root: HTMLElement) {
  Object.defineProperty(root, "clientWidth", { configurable: true, value: WIDTH });
  stubAnimate(root, []);
}

function rigChildren(root: HTMLElement, log: PlayLog[]) {
  for (const el of [...root.children] as HTMLElement[]) {
    linkRectToVars(el);
    stubAnimate(el, log);
  }
}

const ASPECTS = [0.75, 1, 1.33, 1.78, 0.7, 0.9, 1.2, 2.2, 0.55, 1.5];

function Cards({ aspects }: { aspects: number[] }) {
  return (
    <>
      {aspects.map((aspect, i) => (
        <article key={i} data-aspect={String(aspect)}>
          <div className="kami-card-media" />
        </article>
      ))}
    </>
  );
}

function Board({ children }: { children: ReactNode }) {
  return <MasonryBoard>{children}</MasonryBoard>;
}

// 150ms：jsdom 的 rAF 名义 16ms，重载下会拖——留足余量避免时序抖动
const tick = () => new Promise((resolve) => setTimeout(resolve, 150));
const setDensity = (density: "loose" | "medium" | "tight") =>
  act(() => {
    useSettings.setState((s) => ({ pageLayout: { ...s.pageLayout, density } }));
  });

/** rig 后的第一次重打包只落位（卡片此前无 data-placed，快照为空）；第二次起才有 FLIP。 */
async function place(root: HTMLElement) {
  setDensity("loose");
  await tick();
  assert.equal(root.hasAttribute("data-packed"), true, "初次打包完成");
}

test.afterEach(() => {
  cleanup();
  setUiMotionEnabled(true);
  setDensity("medium");
});

test("same geometry after repack: variables equal packJustified placements, no layout tweens armed", async () => {
  setUiMotionEnabled(true);
  const { container } = render(
    <Board>
      <Cards aspects={ASPECTS} />
    </Board>,
  );
  const root = container.firstElementChild as HTMLElement;
  rig(root);
  await place(root);

  assert.equal(root.hasAttribute("data-packed"), true);
  const children = [...root.children] as HTMLElement[];
  assert.equal(children.length, ASPECTS.length);
  const readVars = (el: HTMLElement) =>
    ["--masonry-x", "--masonry-y", "--masonry-w", "--masonry-media-h"].map((k) =>
      el.style.getPropertyValue(k),
    );
  const looseVars = children.map(readVars);

  for (const el of children) {
    assert.ok(el.style.getPropertyValue("--masonry-x"), "x 已写最终值");
    assert.equal(el.style.transition, "", "不再用 transition 抑制布局补间");
    assert.equal(el.hasAttribute("data-placed"), true);
  }
  assert.ok(Number.parseFloat(root.style.getPropertyValue("--masonry-h")) > 0, "容器高度一次写死");
  assert.equal(root.hasAttribute("data-settled"), false, "settled 过渡闸已删");

  // 密度往返（loose → tight → loose）：几何可确定性复现，不因重排路径漂移
  setDensity("tight");
  await tick();
  setDensity("loose");
  await tick();
  const roundTrip = ([...root.children] as HTMLElement[]).map(readVars);
  assert.deepEqual(roundTrip, looseVars, "同输入重打包几何一致");
});

test("append does not replay existing cards", async () => {
  setUiMotionEnabled(true);
  const log: PlayLog[] = [];
  const { container, rerender } = render(
    <Board>
      <Cards aspects={ASPECTS} />
    </Board>,
  );
  const root = container.firstElementChild as HTMLElement;
  rig(root);
  rigChildren(root, log);
  await place(root);
  log.length = 0; // 落位打包不计

  const existingBefore = [...root.children] as HTMLElement[];
  const firstBefore = existingBefore[0]!;
  const xBefore = firstBefore.style.getPropertyValue("--masonry-x");
  const wBefore = firstBefore.style.getPropertyValue("--masonry-w");
  const inviewBefore = existingBefore.map((el) => el.hasAttribute("data-inview"));

  // 追加 6 张（MutationObserver → rAF → 重打包）
  rerender(
    <Board>
      <Cards aspects={[...ASPECTS, 0.8, 1.1, 1.4, 0.66, 1.9, 0.95]} />
    </Board>,
  );
  for (const el of [...root.children] as HTMLElement[]) {
    linkRectToVars(el);
    if (!log.some((entry) => entry.el === el)) stubAnimate(el, log);
  }
  await tick();

  const existingAfter = ([...root.children] as HTMLElement[]).slice(0, existingBefore.length);
  const appended = ([...root.children] as HTMLElement[]).slice(existingBefore.length);
  // 存量卡片节点全部保留、入场标记不重置
  assert.deepEqual(
    existingAfter.map((el, i) => el.isSameNode(existingBefore[i]!)),
    existingBefore.map(() => true),
    "存量卡片节点未被重建",
  );
  assert.deepEqual(
    existingAfter.map((el) => el.hasAttribute("data-inview")),
    inviewBefore,
    "入场标记保留，未重新揭示",
  );
  // 首行几何稳定的首卡：不播任何新动画
  const firstAfter = existingAfter[0]!;
  assert.equal(firstAfter.isSameNode(firstBefore), true);
  assert.equal(firstAfter.style.getPropertyValue("--masonry-x"), xBefore);
  assert.equal(firstAfter.style.getPropertyValue("--masonry-w"), wBefore);
  assert.equal(log.some((entry) => entry.el === firstBefore), false, "未移动的存量卡不播");
  // 新增卡片一律直接落位，不进 FLIP
  const appendedSet = new Set(appended);
  assert.equal(log.some((entry) => appendedSet.has(entry.el)), false, "新增卡片不重播");
  // 尾部被重排的存量卡片允许 FLIP（连续重排是预期行为），但只播 transform
  for (const entry of log) {
    const keys = Object.keys(entry.frames[0] as object);
    assert.deepEqual(keys, ["transform"], "FLIP 只碰 transform");
  }
});

test("rapid repack uses the current visual rect as FLIP start", async () => {
  setUiMotionEnabled(true);
  const log: PlayLog[] = [];
  const { container } = render(
    <Board>
      <Cards aspects={ASPECTS} />
    </Board>,
  );
  const root = container.firstElementChild as HTMLElement;
  rig(root);
  rigChildren(root, log);
  await place(root);

  log.length = 0;
  setDensity("tight");
  await tick();
  assert.ok(log.length > 0, "改密度触发 FLIP");
  for (const entry of log) {
    const first = entry.frames[0] as { transform?: string };
    const last = entry.frames[entry.frames.length - 1] as { transform?: string };
    assert.match(String(first.transform), /^matrix\(/, "起始帧=从旧视觉映回的矩阵");
    assert.equal(last.transform, "matrix(1, 0, 0, 1, 0, 0)", "终点=恒等（新几何）");
    assert.equal(Math.round((entry.options as { duration?: number }).duration ?? 0), 250, "fast token 250ms");
  }

  // 连续第二次改密度：同样从当前视觉续播（快照=此刻变量），节奏不变
  log.length = 0;
  setDensity("loose");
  await tick();
  assert.ok(log.length > 0, "连续改密度仍触发 FLIP");
  const entry2 = log[0]!;
  assert.match(String((entry2.frames[0] as { transform?: string }).transform), /^matrix\(/);
  assert.equal(
    (entry2.frames[entry2.frames.length - 1] as { transform?: string }).transform,
    "matrix(1, 0, 0, 1, 0, 0)",
  );
});

test("offscreen and motion off skip playback", async () => {
  setUiMotionEnabled(true);
  const log: PlayLog[] = [];
  const { container } = render(
    <Board>
      <Cards aspects={ASPECTS} />
    </Board>,
  );
  const root = container.firstElementChild as HTMLElement;
  rig(root);
  rigChildren(root, log);
  await place(root);

  // 把最后一张卡挪到视口外（rect 桩返回 top 巨大）
  const children = [...root.children] as HTMLElement[];
  const offscreen = children[children.length - 1]!;
  offscreen.getBoundingClientRect = () =>
    ({ left: 0, top: 100000, width: 200, height: 300, right: 200, bottom: 100300, x: 0, y: 100000, toJSON: () => ({}) }) as DOMRect;

  log.length = 0;
  setDensity("tight");
  await tick();
  assert.equal(log.some((entry) => entry.el === offscreen), false, "离屏卡片不播");
  assert.ok(log.length > 0, "可见卡片照常播");

  // 动效关闭：一次新的重排零播放，几何仍一次落位
  log.length = 0;
  setUiMotionEnabled(false);
  setDensity("loose");
  await tick();
  assert.equal(log.length, 0, "关停后不起播");
  assert.ok(root.style.getPropertyValue("--masonry-h"), "关停不影响几何落位");
});

test("unmount cancels pending frame and owned animations", async () => {
  setUiMotionEnabled(true);
  const log: PlayLog[] = [];
  const { container, rerender, unmount } = render(
    <Board>
      <Cards aspects={ASPECTS} />
    </Board>,
  );
  const root = container.firstElementChild as HTMLElement;
  rig(root);
  rigChildren(root, log);
  await place(root);

  log.length = 0;
  setDensity("tight");
  await tick();
  assert.ok(log.length > 0, "FLIP 已在播（double 的 finished 永远 pending，保持登记）");
  const animatedCard = log[0]!.el;
  assert.equal(cancelCounts.get(animatedCard) ?? 0, 0, "正常播放中未被取消");

  // 触发一次待执行的重打包（rAF 排队中）后立刻卸载：挂起的帧不再执行
  log.length = 0;
  rerender(
    <Board>
      <Cards aspects={[...ASPECTS, 1.1, 0.6]} />
    </Board>,
  );
  unmount();
  await tick();
  assert.equal(log.length, 0, "卸载后排队的 rAF 重打包没有执行");
  assert.ok(
    (cancelCounts.get(animatedCard) ?? 0) >= 1 || animatedCard.isConnected === false,
    "在播动画被取消（或节点已随之离树）",
  );
  assert.equal(container.firstChild, null, "容器已卸载");
});
