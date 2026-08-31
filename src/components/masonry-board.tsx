import { useLayoutEffect, useRef, type ReactNode } from "react";
import { masonryColumns, masonrySpan, packMasonry } from "@/lib/masonry-flow";
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

function packBoard(root: HTMLElement) {
  const children = [...root.children] as HTMLElement[];
  const width = root.clientWidth;
  if (children.length === 0 || width <= 0) {
    root.style.removeProperty("--masonry-h");
    root.removeAttribute("data-packed");
    return;
  }

  const gap = readGap(root);
  const columns = masonryColumns(width, gap);
  const spans = children.map((el) => masonrySpan(el.dataset.layout, columns));
  const colWidth = (width - gap * (columns - 1)) / columns;

  root.setAttribute("data-packed", "");
  children.forEach((el, i) => {
    const span = spans[i] ?? 1;
    el.style.setProperty("--masonry-w", `${colWidth * span + gap * (span - 1)}px`);
  });

  const packed = packMasonry({
    containerWidth: width,
    columns,
    gap,
    items: children.map((el, i) => ({
      span: spans[i] ?? 1,
      height: el.offsetHeight,
    })),
  });

  children.forEach((el, i) => {
    const place = packed.placements[i];
    if (!place) return;
    el.style.setProperty("--masonry-x", `${place.x}px`);
    el.style.setProperty("--masonry-y", `${place.y}px`);
    el.style.setProperty("--masonry-w", `${place.width}px`);
  });
  root.style.setProperty("--masonry-h", `${packed.height}px`);
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

    const mo = new MutationObserver(run);
    mo.observe(root, { childList: true });

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
