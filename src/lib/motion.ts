/**
 * 动效：只走合成线程。
 *
 * 作用：进场、悬停预览的 FLIP、轻漂。
 * 用法：playEnter(el)；animateFlip(el, from, to)；animateDrift(inner)。
 * 为什么：left/top/width/height 每帧 layout。transform + opacity 才在 GPU。
 *        CSS @keyframes 在 prefers-reduced-motion 下会被打成 0ms，WAAPI 不受影响。
 */
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

export type MotionRect = { left: number; top: number; width: number; height: number };

export function flipTransform(from: MotionRect, to: MotionRect) {
  return {
    dx: from.left - to.left,
    dy: from.top - to.top,
    sx: from.width / Math.max(1, to.width),
    sy: from.height / Math.max(1, to.height),
  };
}

function flipKeyframes(from: MotionRect, to: MotionRect, opacityFrom: number, opacityTo: number) {
  const { dx, dy, sx, sy } = flipTransform(from, to);
  return [
    { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`, opacity: opacityFrom },
    { transform: "translate3d(0, 0, 0) scale(1)", opacity: opacityTo },
  ];
}

export function cancelAnimations(el: HTMLElement) {
  for (const anim of el.getAnimations()) anim.cancel();
  el.style.willChange = "";
}

export function playEnter(el: HTMLElement, delay = 0) {
  cancelAnimations(el);
  el.animate(
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
) {
  cancelAnimations(el);
  el.style.transformOrigin = "0 0";
  el.style.willChange = "transform, opacity";
  const frames = flipKeyframes(from, to, opts?.opacityFrom ?? 0.45, opts?.opacityTo ?? 1);
  const anim = el.animate(opts?.reverse ? [...frames].reverse() : frames, {
    duration: opts?.duration ?? 480,
    easing: EASE_OUT,
    fill: "forwards",
  });
  void anim.finished
    .finally(() => {
      if (el.isConnected) el.style.willChange = "";
    })
    .catch(() => undefined);
  return anim;
}

export function animateDrift(el: HTMLElement, px = 8) {
  cancelAnimations(el);
  el.style.willChange = "transform";
  return el.animate(
    [{ transform: "translate3d(0, 0, 0)" }, { transform: `translate3d(0, ${-px}px, 0)` }],
    { duration: 2800, easing: "ease-in-out", direction: "alternate", iterations: Infinity },
  );
}
