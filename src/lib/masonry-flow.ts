export const MASONRY_GAP = 12;
export const MASONRY_MIN_COL = 170;
export const MASONRY_MAX_COLS = 5;

export type MasonryItem = {
  span: number;
  height: number;
};

export type MasonryPlacement = {
  x: number;
  y: number;
  width: number;
};

export function masonryColumns(
  width: number,
  gap = MASONRY_GAP,
  minCol = MASONRY_MIN_COL,
): number {
  if (width <= 0) return 2;
  return Math.max(2, Math.min(MASONRY_MAX_COLS, Math.floor((width + gap) / (minCol + gap))));
}

export function masonrySpan(layout: string | undefined, columns: number): number {
  if (columns <= 1) return 1;
  if (layout === "banner") return Math.min(columns, columns >= 4 ? 3 : 2);
  if (layout === "wide") return Math.min(2, columns);
  return 1;
}

function band(
  start: number,
  span: number,
  columns: number,
  colWidth: number,
  gap: number,
  containerWidth: number,
): { x: number; width: number } {
  const x = start * (colWidth + gap);
  const end = start + span;
  const right = end >= columns ? containerWidth : end * (colWidth + gap) - gap;
  return { x, width: Math.max(0, right - x) };
}

export function packMasonry({
  containerWidth,
  columns,
  gap,
  items,
}: {
  containerWidth: number;
  columns: number;
  gap: number;
  items: MasonryItem[];
}): { placements: MasonryPlacement[]; height: number } {
  const cols = Math.max(1, columns);
  const colWidth = cols === 1 ? containerWidth : (containerWidth - gap * (cols - 1)) / cols;
  const colY = Array.from({ length: cols }, () => 0);
  const placements: MasonryPlacement[] = [];

  for (const item of items) {
    const span = Math.max(1, Math.min(cols, Math.floor(item.span) || 1));
    let bestCol = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let c = 0; c <= cols - span; c += 1) {
      let y = 0;
      for (let i = 0; i < span; i += 1) y = Math.max(y, colY[c + i] ?? 0);
      if (y < bestY) {
        bestY = y;
        bestCol = c;
      }
    }
    const box = band(bestCol, span, cols, colWidth, gap, containerWidth);
    placements.push({ x: box.x, y: bestY, width: box.width });
    const nextY = bestY + item.height + gap;
    for (let i = 0; i < span; i += 1) colY[bestCol + i] = nextY;
  }

  const tallest = colY.reduce((max, y) => Math.max(max, y), 0);
  return { placements, height: items.length === 0 ? 0 : Math.max(0, tallest - gap) };
}
