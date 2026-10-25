/**
 * SlidingPill 行为测试（动效批 2026-10-25 · Task 4）。
 *
 * 作用：锁「几何一次落位、transform FLIP、不拉伸文字、首挂载不入场」。
 * 用法：node --import tsx --test src/components/ui/sliding-pill.test.tsx。
 * 为什么：滑块以前逐帧过渡 width/height（每帧 layout），换宽度时连文字一起
 *   拉伸；jsdom 无布局，offset 系列全部桩到按钮上，播放用局部 WAAPI double。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, cleanup, render } from "@testing-library/react";
import { SlidingPill, useSlidingPill, type PillBox } from "./sliding-pill.tsx";
import { setUiMotionEnabled } from "@/lib/motion-runtime";

function PillHarness({ active }: { active: "a" | "b" | "none" }) {
  const { rootRef, pill } = useSlidingPill('[data-state="on"]');
  return (
    <div ref={rootRef}>
      <SlidingPill box={pill} className="rounded-full bg-accent" />
      <button type="button" data-state={active === "a" ? "on" : "off"} data-item="a">
        甲项
      </button>
      <button type="button" data-state={active === "b" ? "on" : "off"} data-item="b">
        乙项（更宽）
      </button>
    </div>
  );
}

type Play = { frames: Keyframe[]; options: KeyframeAnimationOptions };

function rigOffsets(root: HTMLElement) {
  const a = root.querySelector('[data-item="a"]') as HTMLElement;
  const b = root.querySelector('[data-item="b"]') as HTMLElement;
  Object.defineProperty(a, "offsetLeft", { configurable: true, value: 0 });
  Object.defineProperty(a, "offsetTop", { configurable: true, value: 0 });
  Object.defineProperty(a, "offsetWidth", { configurable: true, value: 60 });
  Object.defineProperty(a, "offsetHeight", { configurable: true, value: 36 });
  // 乙项换行且更宽：dy + 不同宽度，FLIP 的 scale 分量才可验证
  Object.defineProperty(b, "offsetLeft", { configurable: true, value: 12 });
  Object.defineProperty(b, "offsetTop", { configurable: true, value: 44 });
  Object.defineProperty(b, "offsetWidth", { configurable: true, value: 100 });
  Object.defineProperty(b, "offsetHeight", { configurable: true, value: 36 });
  return { a, b };
}

function pillSpan(root: HTMLElement): HTMLElement {
  return root.querySelector("span[aria-hidden]") as HTMLElement;
}

test.afterEach(() => {
  cleanup();
  setUiMotionEnabled(true);
});

test("首挂载直接显示选中状态，不播入场", async () => {
  setUiMotionEnabled(true);
  const plays: Play[] = [];
  const { container, rerender } = render(<PillHarness active="a" />);
  const root = container.firstElementChild as HTMLElement;
  rigOffsets(root);
  const span = pillSpan(root);
  span.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    plays.push({ frames, options });
    return { finished: new Promise(() => {}), cancel: () => {} } as Animation;
  }) as typeof span.animate;
  // 桩好 offset 后重测一次（mount 时读到的是 jsdom 的零尺寸）
  rerender(<PillHarness active="a" />);
  await act(async () => {});
  assert.equal(plays.length, 0, "首挂载不播");
  assert.equal(span.style.opacity, "1");
  assert.equal(span.style.width, "60px");
});

test("不同宽度换行项选中：几何一次落位，transform FLIP，文字不缩放", async () => {
  setUiMotionEnabled(true);
  const { container, rerender } = render(<PillHarness active="a" />);
  const root = container.firstElementChild as HTMLElement;
  const { b } = rigOffsets(root);
  const plays: Play[] = [];
  const span = pillSpan(root);
  span.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    plays.push({ frames, options });
    return { finished: new Promise(() => {}), cancel: () => {} } as Animation;
  }) as typeof span.animate;
  rerender(<PillHarness active="a" />);
  await act(async () => {});

  rerender(<PillHarness active="b" />);
  await act(async () => {});
  assert.equal(plays.length, 1, "换选中播一次 FLIP");
  const [first, last] = plays[0]!.frames as { transform?: string }[];
  // 起点 = 旧位置对新几何的反演（甲 60px 宽 → 乙 100px：scale 0.6）
  assert.equal(first.transform, "translate3d(0px, 0px, 0) scale(0.6, 1)");
  assert.equal(last.transform, "translate3d(12px, 44px, 0) scale(1, 1)");
  // 几何一次落位：宽度直接是乙项宽，滑块上没有任何 width/height 过渡声明
  assert.equal(span.style.width, "100px");
  assert.equal(span.style.height, "36px");
  assert.doesNotMatch(span.className, /transition-\[/, "不再有逐帧 width/height 过渡");
  // 文字（按钮）从不被缩放——播放只发生在滑块背景层
  assert.equal(plays.filter((p) => (p as unknown as { el?: unknown }).el).length, 0);
  assert.ok(b.textContent, "按钮文字保持原样");
});

test("连续 A→B→A 每段都从当前位置续播，无叠加", async () => {
  setUiMotionEnabled(true);
  const { container, rerender } = render(<PillHarness active="a" />);
  const root = container.firstElementChild as HTMLElement;
  rigOffsets(root);
  const plays: Play[] = [];
  const span = pillSpan(root);
  span.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    plays.push({ frames, options });
    return { finished: new Promise(() => {}), cancel: () => {} } as Animation;
  }) as typeof span.animate;
  rerender(<PillHarness active="a" />);
  await act(async () => {});

  rerender(<PillHarness active="b" />);
  await act(async () => {});
  rerender(<PillHarness active="a" />);
  await act(async () => {});
  assert.equal(plays.length, 2, "两次切换两次播放");
  assert.equal(span.style.width, "60px", "回到甲项几何");
  assert.equal(root.querySelectorAll("span[aria-hidden]").length, 1, "滑块不叠加");
});

test("关停时不播，几何照常落位", async () => {
  setUiMotionEnabled(false);
  const plays: Play[] = [];
  const { container, rerender } = render(<PillHarness active="a" />);
  const root = container.firstElementChild as HTMLElement;
  rigOffsets(root);
  const span = pillSpan(root);
  span.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    plays.push({ frames, options });
    return { finished: new Promise(() => {}), cancel: () => {} } as Animation;
  }) as typeof span.animate;
  await act(async () => {});
  rerender(<PillHarness active="b" />);
  await act(async () => {});
  assert.equal(plays.length, 0, "关停后不起播");
  assert.equal(span.style.width, "100px", "几何仍一次落位");
});

test("PillBox 失焦（无选中）时隐藏滑块并取消在播动画", async () => {
  setUiMotionEnabled(true);
  const plays: Play[] = [];
  let cancels = 0;
  const { container, rerender } = render(<PillHarness active="a" />);
  const root = container.firstElementChild as HTMLElement;
  rigOffsets(root);
  const span = pillSpan(root);
  span.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    plays.push({ frames, options });
    return {
      finished: new Promise((_res, rej) => {
        (span as unknown as { __rej?: (e?: unknown) => void }).__rej = rej;
      }),
      cancel: () => {
        cancels += 1;
        (span as unknown as { __rej?: (e?: unknown) => void }).__rej?.(new Error("cancelled"));
      },
    } as Animation;
  }) as typeof span.animate;
  rerender(<PillHarness active="a" />);
  await act(async () => {});
  rerender(<PillHarness active="b" />);
  await act(async () => {});
  assert.equal(plays.length, 1);

  // 两个按钮都取消选中：滑块隐藏、动画被取消
  rerender(<PillHarness active="none" />);
  await act(async () => {});
  assert.equal(span.style.opacity, "0");
  assert.ok(cancels >= 1, "在播动画被取消");
});
