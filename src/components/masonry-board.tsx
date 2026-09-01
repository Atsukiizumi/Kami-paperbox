/**
 * 浏览网格容器。
 *
 * 作用：量容器宽度，调用 packJustified，把位置写到每个子节点的 CSS 变量。
 * 用法：<MasonryBoard>{cards}</MasonryBoard>；卡片需 data-aspect 和 .kami-card-media。
 * 为什么：useLayoutEffect 在绘制前打包，避免先看到 CSS grid 再跳到绝对定位。
 *        只观察宽度和子节点增删；高度由我们自己写死，不必等图片 onLoad。
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { MASONRY_CAPTION, masonryMinCard, masonryRowHeight, packJustified } from "@/lib/masonry-flow";
import { cn } from "@/lib/utils";

function readGap(root: HTMLElement): number {
  const styles = getComputedStyle(root);
  for (const key of ["gap", "rowGap", "columnGap"] as const) {
    const n = Number.parseFloat(styles[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const token = styles.getPropertyValue("--masonry-gap").trim();
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n) || n <= 0) return 12;
  if (token.endsWith("rem")) return n * (Number.parseFloat(styles.fontSize) || 16);
  return n;
}

function readAspect(el: HTMLElement): number {
  const raw = Number.parseFloat(el.dataset.aspect || "");
  if (Number.isFinite(raw) && raw > 0) return raw;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (w > 0 && h > 0) return w / Math.max(1, h - MASONRY_CAPTION);
  return 0.75;
}

function packBoard(root: HTMLElement) {
  const children = [...root.children] as HTMLElement[];
  const width = root.clientWidth;
  if (children.length === 0 || width <= 0) {
    root.style.removeProperty("--masonry-h");
    root.removeAttribute("data-packed");
    return;
  }

  const gap = readGap(root);
  const hasCaption = children.some((el) => el.querySelector(".kami-card-media"));
  const packed = packJustified({
    containerWidth: width,
    gap,
    items: children.map((el) => ({ aspect: readAspect(el) })),
    idealHeight: masonryRowHeight(width),
    captionBand: hasCaption ? MASONRY_CAPTION : 0,
    minWidth: masonryMinCard(width, gap),
  });

  root.setAttribute("data-packed", "");
  const settled = root.hasAttribute("data-settled");
  children.forEach((el, i) => {
    const place = packed.placements[i];
    if (!place) return;
    const fresh = !el.hasAttribute("data-placed");
    if (fresh) el.style.transition = "none";
    el.style.setProperty("--masonry-x", `${place.x}px`);
    el.style.setProperty("--masonry-y", `${place.y}px`);
    el.style.setProperty("--masonry-w", `${place.width}px`);
    el.style.setProperty("--masonry-media-h", `${place.height}px`);
    el.setAttribute("data-placed", "");
    if (fresh && settled) {
      requestAnimationFrame(() => el.style.removeProperty("transition"));
    }
  });
  root.style.setProperty("--masonry-h", `${packed.height}px`);
  if (!settled) {
    requestAnimationFrame(() => root.setAttribute("data-settled", ""));
  }
}

export function MasonryBoard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    let lastWidth = -1;
    let frame = 0;

    const run = () => {
      frame = 0;
      packBoard(root);
      lastWidth = root.clientWidth;
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(run);
    };

    run();

    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? root.clientWidth;
      if (Math.abs(next - lastWidth) < 0.5) return;
      schedule();
    });
    ro.observe(root);

    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: false });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={cn("kami-masonry", className)}>
      {children}
    </div>
  );
}
