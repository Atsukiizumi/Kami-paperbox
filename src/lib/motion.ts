/**
 * 动效：只走合成线程。
 *
 * 作用：进场、悬停预览的 FLIP、轻漂。
 * 用法：playEnter(el)；animateFlip(el, from, to)；animateDrift(inner)。
 * 为什么：left/top/width/height 每帧 layout。transform + opacity 才在 GPU。
 *        中断时先 commitOwnedMotion 再朝新终点播，cancel() 会卸效果导致闪回。
 *        生命周期（开关、终态固化、will-change 回收）统一交给 motion-runtime。
 */
import {
  canAnimateUi,
  cancelOwnedAnimations,
  commitOwnedMotion,
  hasOwnedAnimations,
  playOwnedMotion,
  type MotionEnd,
  type OwnedMotion,
} from "./motion-runtime.ts";

export type { MotionEnd, OwnedMotion };

export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const IDENTITY_MATRIX = "matrix(1, 0, 0, 1, 0, 0)";

export type MotionRect = { left: number; top: number; width: number; height: number };

/** 开关关闭 / 策略未明时直接给已完成的句柄——底层状态就是终态，不碰元素。 */
function disabledMotion(): OwnedMotion {
  return { finished: Promise.resolve<MotionEnd>("disabled"), finish: () => {}, cancel: () => {} };
}

export function flipTransform(from: MotionRect, to: MotionRect) {
  return {
    dx: from.left - to.left,
    dy: from.top - to.top,
    sx: from.width / Math.max(1, to.width),
    sy: from.height / Math.max(1, to.height),
  };
}

export function flipMatrix(from: MotionRect, to: MotionRect) {
  const { dx, dy, sx, sy } = flipTransform(from, to);
  return `matrix(${sx}, 0, 0, ${sy}, ${dx}, ${dy})`;
}

/** 0 = 还在 First，1 = 已经到 Last。用视觉矩形，含正在播的 transform。 */
export function flipProgress(from: MotionRect, to: MotionRect, visual: MotionRect) {
  const total = Math.hypot(to.left - from.left, to.top - from.top) + Math.abs(to.width - from.width);
  if (total < 1) return 1;
  const remain = Math.hypot(to.left - visual.left, to.top - visual.top) + Math.abs(to.width - visual.width);
  return Math.max(0, Math.min(1, 1 - remain / total));
}

export function playEnter(el: HTMLElement, delay = 0): OwnedMotion {
  if (!canAnimateUi(el)) return disabledMotion();
  cancelOwnedAnimations(el);
  return playOwnedMotion(
    el,
    [
      { opacity: 0, transform: "translate3d(0, 16px, 0)" },
      { opacity: 1, transform: "translate3d(0, 0, 0)" },
    ],
    { duration: 420, delay, easing: EASE_OUT, fill: "both" },
  );
}

export function animateFlip(
  el: HTMLElement,
  from: MotionRect,
  to: MotionRect,
  opts?: { duration?: number; reverse?: boolean; opacityFrom?: number; opacityTo?: number },
): OwnedMotion {
  if (!canAnimateUi(el)) return disabledMotion();
  const invert = flipMatrix(from, to);
  const full = opts?.duration ?? 480;
  const endTransform = opts?.reverse ? invert : IDENTITY_MATRIX;
  const endOpacity = opts?.reverse ? (opts?.opacityFrom ?? 0) : (opts?.opacityTo ?? 1);

  el.style.transformOrigin = "0 0";
  el.style.willChange = "transform, opacity";

  const interrupted = hasOwnedAnimations(el);
  let startTransform: string;
  let startOpacity: number;
  let duration = full;

  if (interrupted) {
    // 改向：从当前视觉续播，不跳回 First。先截住视觉再取消旧动画，避免闪回。
    const visual = el.getBoundingClientRect();
    const progress = flipProgress(from, to, {
      left: visual.left,
      top: visual.top,
      width: visual.width,
      height: visual.height,
    });
    const travel = opts?.reverse ? progress : 1 - progress;
    duration = Math.max(140, Math.round(full * travel));
    const now = commitOwnedMotion(el);
    startTransform = now.transform;
    startOpacity = now.opacity;
  } else {
    startTransform = opts?.reverse ? IDENTITY_MATRIX : invert;
    startOpacity = opts?.reverse ? (opts?.opacityTo ?? 1) : (opts?.opacityFrom ?? 0.45);
  }

  return playOwnedMotion(
    el,
    [
      { transform: startTransform, opacity: startOpacity },
      { transform: endTransform, opacity: endOpacity },
    ],
    { duration, easing: EASE_OUT, fill: "both" },
  );
}

export function animateDrift(el: HTMLElement, px = 8): OwnedMotion {
  if (!canAnimateUi(el)) return disabledMotion();
  cancelOwnedAnimations(el);
  el.style.willChange = "transform";
  return playOwnedMotion(
    el,
    [{ transform: "translate3d(0, 0, 0)" }, { transform: `translate3d(0, ${-px}px, 0)` }],
    { duration: 2800, easing: "ease-in-out", direction: "alternate", iterations: Infinity },
  );
}
