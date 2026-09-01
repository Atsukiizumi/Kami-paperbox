/**
 * 卡片悬停放大预览。
 *
 * 作用：从封面浮到旁边，按真实比例看整张图。
 * 用法：open + 卡片 getBoundingClientRect；pointer-events: none。
 * 为什么：节点铺在终点尺寸上，用 FLIP（transform）从卡片长过去。
 *        中断时 commitStyles，从当前矩阵接着播，不 cancel 回起点。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animateDrift, animateFlip, cancelAnimations } from "@/lib/motion";
import { ProxiedImg } from "./proxied-img";

function place(anchor: DOMRect, aspect: number) {
  const maxW = Math.min(520, window.innerWidth - 24);
  const width = Math.min(maxW, Math.max(300, Math.round(anchor.width * 1.85)));
  const height = Math.min(window.innerHeight - 24, Math.round(width / Math.max(aspect, 0.4)));
  let left = anchor.right + 16;
  let top = anchor.top;
  if (left + width > window.innerWidth - 12) left = anchor.left - 16 - width;
  if (left < 12) left = 12;
  if (top + height > window.innerHeight - 12) top = window.innerHeight - 12 - height;
  if (top < 12) top = 12;
  return { left, top, width, height };
}

export function HoverPreview({
  open,
  src,
  alt,
  aspect,
  anchor,
}: {
  open: boolean;
  src?: string;
  alt: string;
  aspect: number;
  anchor: DOMRect | null;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const held = useRef<{ src: string; alt: string; aspect: number; from: DOMRect } | null>(null);
  const [shown, setShown] = useState(false);

  if (open && src && anchor) {
    held.current = { src, alt, aspect, from: anchor };
  }
  const shot = held.current;

  useLayoutEffect(() => {
    const shell = outer.current;
    const float = inner.current;
    const pack = held.current;
    if (!shell || !float || !pack) return;

    // 只停内层轻漂。外层若在飞，交给 animateFlip commitStyles，cleanup 里 cancel 会闪回。
    cancelAnimations(float);
    let live = true;
    const to = place(pack.from, pack.aspect);

    if (open) {
      setShown(true);
      const rise = animateFlip(shell, pack.from, to, { duration: 480, opacityFrom: 0.4 });
      void rise.finished
        .then(() => {
          if (!live || !inner.current) return;
          animateDrift(inner.current, 8);
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }

    const back = animateFlip(shell, pack.from, to, {
      duration: 320,
      reverse: true,
      opacityFrom: 0,
      opacityTo: 1,
    });
    void back.finished
      .then(() => {
        if (live) setShown(false);
      })
      .catch(() => {
        if (live) setShown(false);
      });
    return () => {
      live = false;
    };
  }, [open, src]);

  if (!shown && !open) return null;
  if (!shot || typeof document === "undefined") return null;
  const to = place(shot.from, shot.aspect);

  return createPortal(
    <div
      ref={outer}
      className="pointer-events-none fixed z-[55] overflow-hidden rounded-xl bg-bg shadow-[var(--shadow-float)]"
      style={{
        left: to.left,
        top: to.top,
        width: to.width,
        height: to.height,
        transformOrigin: "0 0",
      }}
    >
      <div ref={inner} className="size-full">
        <ProxiedImg src={shot.src} alt={shot.alt} fit="cover" className="absolute inset-0 size-full" />
      </div>
    </div>,
    document.body,
  );
}

export function canHoverPreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
