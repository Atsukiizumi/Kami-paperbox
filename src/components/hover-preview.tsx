/**
 * 卡片悬停放大预览。
 *
 * 作用：鼠标停在封面上，旁边弹出整张图，不被卡片裁切。
 * 用法：HoverPreview 用卡片 getBoundingClientRect 定位；pointer-events: none。
 * 为什么：封面是 object-cover，竖图/横图都会被裁。预览用 contain 才是原图构图。
 */
import { createPortal } from "react-dom";
import { ProxiedImg } from "./proxied-img";

export function HoverPreview({
  src,
  alt,
  aspect,
  anchor,
}: {
  src: string;
  alt: string;
  aspect: number;
  anchor: DOMRect;
}) {
  const maxW = Math.min(520, window.innerWidth - 24);
  const width = Math.min(maxW, Math.max(300, Math.round(anchor.width * 1.85)));
  const height = Math.min(window.innerHeight - 24, Math.round(width / Math.max(aspect, 0.4)));
  let left = anchor.right + 14;
  let top = anchor.top;
  if (left + width > window.innerWidth - 12) left = anchor.left - 14 - width;
  if (left < 12) left = 12;
  if (top + height > window.innerHeight - 12) top = window.innerHeight - 12 - height;
  if (top < 12) top = 12;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[55] overflow-hidden rounded-xl bg-bg shadow-[var(--shadow-float)]"
      style={{ left, top, width, height }}
    >
      <ProxiedImg src={src} alt={alt} fit="cover" className="absolute inset-0 size-full" />
    </div>,
    document.body,
  );
}

export function canHoverPreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
