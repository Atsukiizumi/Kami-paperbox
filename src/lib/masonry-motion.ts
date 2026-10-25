/**
 * 浏览网格重排 FLIP（动效批 2026-10-25 · Task 2）。
 *
 * 作用：MasonryBoard 重打包时，存量可见卡片从旧视觉位置连续滑到新几何，
 *   而不是让 left/top/width 逐帧补间（每帧 layout 的老路径已删）。
 * 用法：packBoard 里「写最终几何前」snapshotMasonry(root) 存旧视觉矩形，
 *   「一次写完所有几何与容器高度后」playMasonryReflow(root, before)；
 *   卸载时 clearMasonryMotion(root) 收掉在播动画。
 * 为什么：FLIP 只碰 transform（合成线程）；旧视觉矩形含在播 transform，
 *   连续改向（快速改密度/缩放窗口）不闪回。读与写整批分开，避免逐卡
 *   读-写-读的强制布局循环。只处理 root 的直接子卡片；新增卡片不播，
 *   离屏或无有效尺寸的直接落位——reveal 是 IO 的职责，不在这里。
 */
import { flipMatrix, IDENTITY_MATRIX, type MotionRect } from "./motion.ts";
import { canAnimateUi, cancelOwnedAnimations, playOwnedMotion, readMotionTiming } from "./motion-runtime.ts";

/** 可视区上下各放宽 120px：刚滚出/即将滚入的卡片保持连续。 */
const VIEWPORT_MARGIN = 120;

function cardRect(el: HTMLElement): MotionRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 打包前的旧视觉矩形（含在播 transform）。未落位过 / 无有效尺寸的卡片不进快照。 */
export function snapshotMasonry(root: HTMLElement): Map<HTMLElement, MotionRect> {
  const map = new Map<HTMLElement, MotionRect>();
  for (const el of Array.from(root.children) as HTMLElement[]) {
    if (!el.hasAttribute("data-placed")) continue;
    const rect = cardRect(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    map.set(el, rect);
  }
  return map;
}

/** 给存量可见卡片播 250ms transform FLIP。几何此刻必须已写完（最终值）。 */
export function playMasonryReflow(root: HTMLElement, before: Map<HTMLElement, MotionRect>): void {
  if (before.size === 0 || !canAnimateUi(root)) return;
  const vh = root.ownerDocument.defaultView?.innerHeight ?? 0;
  if (vh <= 0) return;

  // 先整批读新矩形（此时无样式写入，一次强制布局出全部结果）
  const moves: { el: HTMLElement; from: MotionRect; to: MotionRect }[] = [];
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const from = before.get(el);
    if (!from) continue; // 新增卡片：直接落位，不重播
    const to = cardRect(el);
    if (to.width <= 0 || to.height <= 0) continue; // 隐藏 / 无效尺寸
    if (to.top > vh + VIEWPORT_MARGIN || to.top + to.height < -VIEWPORT_MARGIN) continue; // 离屏
    const moved =
      Math.abs(from.left - to.left) >= 1 ||
      Math.abs(from.top - to.top) >= 1 ||
      Math.abs(from.width - to.width) >= 1 ||
      Math.abs(from.height - to.height) >= 1;
    if (!moved) continue;
    moves.push({ el, from, to });
  }

  for (const { el, from, to } of moves) {
    cancelOwnedAnimations(el); // 旧 FLIP 的效果直接被新关键帧接管（起点=旧视觉，无闪跳）
    el.style.transformOrigin = "0 0";
    el.style.willChange = "transform";
    const { duration, easing } = readMotionTiming(el, "fast");
    playOwnedMotion(
      el,
      [{ transform: flipMatrix(from, to) }, { transform: IDENTITY_MATRIX }],
      { duration, easing, fill: "both" },
      () => {
        // 结束后清掉 settle 固化出来的行内 transform（终态就是无 transform）
        el.style.removeProperty("transform");
        el.style.removeProperty("transform-origin");
      },
    );
  }
}

/** 卸载 / 拆板时收掉在播的重排动画。 */
export function clearMasonryMotion(root: HTMLElement): void {
  for (const el of Array.from(root.children) as HTMLElement[]) {
    cancelOwnedAnimations(el);
  }
}
