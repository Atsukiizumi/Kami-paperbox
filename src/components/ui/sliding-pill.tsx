/**
 * 选中滑块。
 *
 * 作用：Tabs / ToggleGroup 底下那块跟着点的项滑。
 * 用法：root 相对定位，pill 绝对定位；用 offsetLeft/Top 跟踪 [data-state=on|active]。
 * 为什么：换背景色看不出动，滑块是交互时唯一一定看得到的位移。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

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

export function pillStyle(pill: PillBox): CSSProperties {
  return {
    width: pill.w,
    height: pill.h,
    opacity: pill.on ? 1 : 0,
    transform: `translate3d(${pill.x}px, ${pill.y}px, 0)`,
  };
}
