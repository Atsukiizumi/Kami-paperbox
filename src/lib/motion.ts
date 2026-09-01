/**
 * 动效：只走合成线程。
 *
 * 作用：进场、悬停预览的 FLIP、轻漂。
 * 用法：playEnter(el)；animateFlip(el, from, to)；animateDrift(inner)。
 * 为什么：left/top/width/height 每帧 layout。transform + opacity 才在 GPU。
 *        中断时先 commitStyles 再朝新终点播，cancel() 会卸效果导致闪回。
 */
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const IDENTITY_MATRIX = "matrix(1, 0, 0, 1, 0, 0)";

export type MotionRect = { left: number; top: number; width: number; height: number };

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

export function readComputedMotion(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const transform = !cs.transform || cs.transform === "none" ? IDENTITY_MATRIX : cs.transform;
  const opacity = Number.parseFloat(cs.opacity);
  return { transform, opacity: Number.isFinite(opacity) ? opacity : 1 };
}

/** 把正在播的关键帧写进 style，再 cancel。不写就卸效果，画面会跳回 Last。 */
export function commitMotion(el: HTMLElement) {
  const now = readComputedMotion(el);
  for (const anim of el.getAnimations()) {
    try {
      anim.commitStyles();
    } catch {
      el.style.transform = now.transform;
      el.style.opacity = String(now.opacity);
    }
    anim.cancel();
  }
  return readComputedMotion(el);
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
  const invert = flipMatrix(from, to);
  const full = opts?.duration ?? 480;
  const endTransform = opts?.reverse ? invert : IDENTITY_MATRIX;
  const endOpacity = opts?.reverse ? (opts?.opacityFrom ?? 0) : (opts?.opacityTo ?? 1);

  el.style.transformOrigin = "0 0";
  el.style.willChange = "transform, opacity";

  const running = el.getAnimations().length > 0;
  let startTransform: string;
  let startOpacity: number;
  let duration = full;

  if (running) {
    const visual = el.getBoundingClientRect();
    const progress = flipProgress(from, to, {
      left: visual.left,
      top: visual.top,
      width: visual.width,
      height: visual.height,
    });
    const travel = opts?.reverse ? progress : 1 - progress;
    duration = Math.max(140, Math.round(full * travel));
    const now = commitMotion(el);
    startTransform = now.transform;
    startOpacity = now.opacity;
  } else {
    startTransform = opts?.reverse ? IDENTITY_MATRIX : invert;
    startOpacity = opts?.reverse ? (opts?.opacityTo ?? 1) : (opts?.opacityFrom ?? 0.45);
  }

  const anim = el.animate(
    [
      { transform: startTransform, opacity: startOpacity },
      { transform: endTransform, opacity: endOpacity },
    ],
    { duration, easing: EASE_OUT, fill: "both" },
  );
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
