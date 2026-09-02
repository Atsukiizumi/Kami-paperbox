/**
 * 卡片悬停放大预览。
 *
 * 作用：封面从格子里长出来，用更大一档的图。
 * 用法：open + 卡片 getBoundingClientRect；源卡片自己把封面 opacity 隐掉。
 * 为什么：以前浮到旁边等于两张一样的图叠在网格上。从中心放大，才是同一张在变大。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animateFlip, cancelAnimations } from "@/lib/motion";
import { upgradeThumbUrl } from "@/lib/thumb-url";
import { ProxiedImg } from "./proxied-img";

function place(anchor: DOMRect, aspect: number) {
  const maxW = Math.min(window.innerWidth - 32, 560);
  const width = Math.min(maxW, Math.max(anchor.width * 1.32, Math.min(anchor.width + 80, maxW)));
  const height = Math.min(window.innerHeight - 32, Math.round(width / Math.max(aspect, 0.4)));
  let left = anchor.left + (anchor.width - width) / 2;
  let top = anchor.top + (anchor.height - height) / 2;
  left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - height - 16));
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
  const held = useRef<{ src: string; alt: string; aspect: number; from: DOMRect } | null>(null);
  const [shown, setShown] = useState(false);

  if (open && src && anchor) {
    held.current = { src, alt, aspect, from: anchor };
  }
  const shot = held.current;

  useLayoutEffect(() => {
    const shell = outer.current;
    const pack = held.current;
    if (!shell || !pack) return;

    let live = true;
    const to = place(pack.from, pack.aspect);

    if (open) {
      setShown(true);
      animateFlip(shell, pack.from, to, { duration: 320, opacityFrom: 1 });
      return () => {
        live = false;
      };
    }

    const back = animateFlip(shell, pack.from, to, {
      duration: 280,
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
  const hd = upgradeThumbUrl(shot.src);

  return createPortal(
    <>
      <div
        className="pointer-events-none fixed inset-0 z-[54]"
        style={{
          opacity: open ? 1 : 0,
          transition: "opacity 180ms ease",
          background:
            "radial-gradient(ellipse at center, transparent 42%, color-mix(in oklab, var(--color-bg) 55%, transparent) 100%)",
        }}
      />
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
        <ProxiedImg
          src={hd}
          alt={shot.alt}
          fit="cover"
          priority
          className="absolute inset-0 size-full"
        />
      </div>
    </>,
    document.body,
  );
}

export function canHoverPreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
