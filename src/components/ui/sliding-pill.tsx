/**
 * 选中滑块。
 *
 * 作用：Tabs / ToggleGroup 底下那块跟着点的项滑。
 * 用法：root 相对定位 + <SlidingPill box={pill} className="…底色圆角…" />；
 *      box 来自 useSlidingPill('[data-state="on"]')。
 * 为什么：换背景色看不出动，滑块是交互时唯一一定看得到的位移。几何（宽高）
 *        一次落位、位移用 transform FLIP 补间（动效批 Task 4）——不同宽度的
 *        项之间过渡不再逐帧改 width/height（每帧 layout），文字也从不被拉伸
 *        （滑块是纯背景层，不包裹内容）。首挂载直接到位，不播入场。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { cancelOwnedAnimations, playOwnedMotion, readMotionTiming } from "@/lib/motion-runtime";

export type PillBox = { x: number; y: number; w: number; h: number; on: boolean };

export function useSlidingPill(selector: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<PillBox>({ x: 0, y: 0, w: 0, h: 0, on: false });

  const measure = useCallback(() => {
    const root = rootRef.current;
    const active = root?.querySelector<HTMLElement>(selector);
    if (!root || !active) {
      setPill((prev) => (prev.on ? { ...prev, on: false } : prev));
      return;
    }
    const next = {
      x: active.offsetLeft,
      y: active.offsetTop,
      w: active.offsetWidth,
      h: active.offsetHeight,
      on: true,
    };
    setPill((prev) =>
      prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h && prev.on
        ? prev
        : next,
    );
  }, [selector]);

  useLayoutEffect(measure);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const mo = new MutationObserver(measure);
    mo.observe(root, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return { rootRef, pill, measure };
}

/** 纯背景滑块：不包裹文字；几何即时落位，移动/伸缩走 transform FLIP。 */
export function SlidingPill({ box, className }: { box: PillBox; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<PillBox | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const before = prev.current;
    prev.current = box;
    if (!el) return;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
    el.style.opacity = box.on ? "1" : "0";
    el.style.transformOrigin = "0 0";
    // 静止态：几何（位置+尺寸）一次落位——不播时也在选中项底下
    el.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
    if (!box.on) {
      cancelOwnedAnimations(el);
      return;
    }
    // 首次显示、无旧位置、或旧几何无效（挂载瞬间的零尺寸/隐藏容器）：直接到位，不播入场
    if (!before || !before.on || (before.w < 1 && before.h < 1)) return;
    const sx = before.w / Math.max(1, box.w);
    const sy = before.h / Math.max(1, box.h);
    if (
      Math.abs(before.x - box.x) < 1 &&
      Math.abs(before.y - box.y) < 1 &&
      Math.abs(sx - 1) < 0.01 &&
      Math.abs(sy - 1) < 0.01
    ) {
      return;
    }
    cancelOwnedAnimations(el);
    const { duration, easing } = readMotionTiming(el, "quick");
    playOwnedMotion(
      el,
      [
        { transform: `translate3d(${before.x}px, ${before.y}px, 0) scale(${sx}, ${sy})` },
        { transform: `translate3d(${box.x}px, ${box.y}px, 0) scale(1, 1)` },
      ],
      { duration, easing, fill: "both" },
    );
  }, [box]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none absolute top-0 left-0", className)}
      style={{ opacity: 0 }}
    />
  );
}
