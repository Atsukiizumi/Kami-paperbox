/**
 * 浏览网格容器。
 *
 * 作用：量容器宽度，调用 packJustified，把位置写到每个子节点的 CSS 变量。
 * 用法：<MasonryBoard>{cards}</MasonryBoard>；卡片需 data-aspect 和 .kami-card-media。
 * 为什么：useLayoutEffect 在绘制前打包，避免先看到 CSS grid 再跳到绝对定位。
 *        只观察宽度和子节点增删；高度由我们自己写死，不必等图片 onLoad。
 *        宽度是 CSS 像素，浏览器缩放会改 clientWidth，ResizeObserver 会重排。
 *        整批换站时由外层 key 拆掉容器，避免卸掉的卡片还绝对定位留在里面。
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { MASONRY_CAPTION, MASONRY_MAX_COLS, masonryMinCard, masonryRowHeight, packJustified } from "@/lib/masonry-flow";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { clearMasonryMotion, playMasonryReflow, snapshotMasonry } from "@/lib/masonry-motion";

/** 浏览密度（布局引擎 P1）：目标行高乘数——medium = 现状 1.0；只影响打包几何，不动 CSS。 */
const DENSITY_FACTOR = { loose: 1.18, medium: 1, tight: 0.85 } as const;

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

let inviewObserver: IntersectionObserver | null = null;
if (typeof IntersectionObserver !== "undefined") {
  inviewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.setAttribute("data-inview", "");
          inviewObserver?.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "120px 0px" },
  );
}

function packBoard(root: HTMLElement) {
  const children = [...root.children] as HTMLElement[];
  const width = root.clientWidth;
  if (children.length === 0 || width <= 0) {
    root.style.removeProperty("--masonry-h");
    root.removeAttribute("data-packed");
    return;
  }

  // FLIP 前：整批读旧视觉矩形（含在播 transform）。几何写完后 playMasonryReflow
  // 只给存量可见卡片播 transform 补间；left/top/width 不再逐帧过渡（动效批 Task 2）。
  const before = snapshotMasonry(root);

  const gap = readGap(root);
  const hasCaption = children.some((el) => el.querySelector(".kami-card-media"));
  const maxCols = Number.parseInt(root.dataset.maxCols || "", 10);
  const cols = Number.isFinite(maxCols) && maxCols > 0 ? maxCols : MASONRY_MAX_COLS;
  const density = (root.dataset.density as keyof typeof DENSITY_FACTOR) || "medium";
  const packed = packJustified({
    containerWidth: width,
    gap,
    items: children.map((el) => ({ aspect: readAspect(el) })),
    idealHeight: masonryRowHeight(width, cols) * (DENSITY_FACTOR[density] ?? 1),
    captionBand: hasCaption ? MASONRY_CAPTION : 0,
    minWidth: masonryMinCard(width, gap, cols),
  });

  root.setAttribute("data-packed", "");
  children.forEach((el, i) => {
    const place = packed.placements[i];
    if (!place) return;
    el.style.setProperty("--masonry-x", `${place.x}px`);
    el.style.setProperty("--masonry-y", `${place.y}px`);
    el.style.setProperty("--masonry-w", `${place.width}px`);
    el.style.setProperty("--masonry-media-h", `${place.height}px`);
    el.setAttribute("data-placed", "");
    if (inviewObserver && !el.hasAttribute("data-inview")) inviewObserver.observe(el);
  });
  // 容器高度一次落位（不补间），滚动锚点交给浏览器默认行为
  root.style.setProperty("--masonry-h", `${packed.height}px`);
  playMasonryReflow(root, before);
}

export function MasonryBoard({
  children,
  className,
  maxCols,
}: {
  children: ReactNode;
  className?: string;
  maxCols?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 浏览密度直接读设置（布局引擎 P1）：所有瀑布面板共用一档，改设置即时重排。
  const density = useSettings((s) => s.pageLayout.density);

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
    mo.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-aspect"],
    });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      clearMasonryMotion(root);
      ro.disconnect();
      mo.disconnect();
    };
  }, [maxCols, density]);

  return (
    <div ref={ref} data-max-cols={maxCols || undefined} data-density={density} className={cn("kami-masonry", className)}>
      {children}
    </div>
  );
}

