/**
 * 卡片悬停放大预览。
 *
 * 作用：从封面浮到旁边，按真实比例看整张图。
 * 用法：open + 卡片 getBoundingClientRect；pointer-events: none。
 * 为什么：封面 object-cover 会裁图。用 WAAPI 做位移，不靠 CSS animation
 *        （预览环境常把 prefers-reduced-motion 打成 0ms）。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/lib/motion";
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
  const node = useRef<HTMLDivElement>(null);
  const held = useRef<{ src: string; alt: string; aspect: number; from: DOMRect } | null>(null);
  const drift = useRef<Animation | null>(null);
  const [shown, setShown] = useState(false);

  if (open && src && anchor) {
    held.current = { src, alt, aspect, from: anchor };
  }
  const shot = held.current;

  useLayoutEffect(() => {
    const el = node.current;
    const pack = held.current;
    if (!el || !pack) return;

    drift.current?.cancel();
    drift.current = null;
    let live = true;

    if (open) {
      setShown(true);
      const to = place(pack.from, pack.aspect);
      const from = pack.from;
      const rise = el.animate(
        [
          {
            left: `${from.left}px`,
            top: `${from.top}px`,
            width: `${from.width}px`,
            height: `${from.height}px`,
            opacity: 0.4,
          },
          {
            left: `${to.left}px`,
            top: `${to.top - 6}px`,
            width: `${to.width}px`,
            height: `${to.height}px`,
            opacity: 1,
          },
        ],
        { duration: 520, easing: EASE_OUT, fill: "forwards" },
      );
      void rise.finished
        .then(() => {
          if (!live || !node.current) return;
          drift.current = node.current.animate(
            [
              { transform: "translate3d(0, 0, 0)" },
              { transform: "translate3d(0, -8px, 0)" },
            ],
            { duration: 2800, easing: "ease-in-out", direction: "alternate", iterations: Infinity },
          );
        })
        .catch(() => undefined);
      return () => {
        live = false;
        rise.cancel();
        drift.current?.cancel();
      };
    }

    const to = place(pack.from, pack.aspect);
    const back = el.animate(
      [
        {
          left: `${to.left}px`,
          top: `${to.top}px`,
          width: `${to.width}px`,
          height: `${to.height}px`,
          opacity: 1,
        },
        {
          left: `${pack.from.left}px`,
          top: `${pack.from.top}px`,
          width: `${pack.from.width}px`,
          height: `${pack.from.height}px`,
          opacity: 0,
        },
      ],
      { duration: 280, easing: EASE_OUT, fill: "forwards" },
    );
    void back.finished.then(() => { if (live) setShown(false); }).catch(() => { if (live) setShown(false); });
    return () => {
      live = false;
      back.cancel();
    };
  }, [open, src]);

  if (!shown && !open) return null;
  if (!shot || typeof document === "undefined") return null;
  const to = place(shot.from, shot.aspect);

  return createPortal(
    <div
      ref={node}
      className="pointer-events-none fixed z-[55] overflow-hidden rounded-xl bg-bg shadow-[var(--shadow-float)]"
      style={{ left: to.left, top: to.top, width: to.width, height: to.height }}
    >
      <ProxiedImg src={shot.src} alt={shot.alt} fit="cover" className="absolute inset-0 size-full" />
    </div>,
    document.body,
  );
}

export function canHoverPreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
