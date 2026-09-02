/**
 * 浏览页拼版。
 *
 * 作用：把不同长宽比的卡片排进容器，同一行等高、横向撑满，中间不留大洞。
 * 用法：packJustified({ containerWidth, gap, items: [{ aspect }] })。
 *      MasonryBoard 会读卡片的 data-aspect，把 x/y/width/媒体高度写到 CSS 变量。
 * 为什么按行撑满而不是瀑布流跨列：横图跨两列会在竖图旁边留空（红框那种洞）。
 *        最小宽度（masonryMinCard）避免竖图被挤成一条，标题只剩「私…」。
 *        单独一张竖图绝不拉满整行：否则封面只剩左边一条。
 *        单独一张横图 / 宽图仍然铺这一行，避免 16:9 被收成小条。
 * packMasonry 仍留给测试/旧逻辑，界面不再调用。
 */
export const MASONRY_GAP = 12;
export const MASONRY_MIN_COL = 170;
export const MASONRY_MAX_COLS = 5;
export const MASONRY_CAPTION = 88;
export const MASONRY_MIN_CARD = 188;

const FALLBACK_ASPECT = 3 / 4;
const MIN_ASPECT = 0.45;
const WIDE_ASPECT = 4 / 3;
const MAX_PANORAMA_ASPECT = 3.2;

export type MasonryItem = {
  span: number;
  height: number;
};

export type MasonryPlacement = {
  x: number;
  y: number;
  width: number;
};

export type JustifiedItem = {
  aspect: number;
};

export type JustifiedPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function masonryColumns(
  width: number,
  gap = MASONRY_GAP,
  minCol = MASONRY_MIN_COL,
  maxCols = MASONRY_MAX_COLS,
): number {
  if (width <= 0) return Math.max(1, Math.min(2, maxCols));
  return Math.max(1, Math.min(maxCols, Math.floor((width + gap) / (minCol + gap))));
}

export function masonrySpan(layout: string | undefined, columns: number): number {
  if (columns <= 1) return 1;
  if (layout === "banner") return Math.min(columns, columns >= 4 ? 3 : 2);
  if (layout === "wide") return Math.min(2, columns);
  return 1;
}

export function masonryRowHeight(width: number, maxCols = MASONRY_MAX_COLS): number {
  const cols = masonryColumns(width, MASONRY_GAP, MASONRY_MIN_COL, maxCols);
  return Math.round(Math.max(160, Math.min(320, width / cols / 0.72)));
}

export function masonryMinCard(width: number, gap = MASONRY_GAP, maxCols = MASONRY_MAX_COLS): number {
  const cols = masonryColumns(width, gap, MASONRY_MIN_COL, maxCols);
  const col = cols <= 1 ? width : (width - gap * (cols - 1)) / cols;
  return Math.max(96, Math.min(MASONRY_MIN_CARD, Math.floor(col)));
}

export function clampAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return FALLBACK_ASPECT;
  return Math.min(MAX_PANORAMA_ASPECT, Math.max(MIN_ASPECT, aspect));
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

/**
 * Flickr / Google Images style: each row shares a height and the cards
 * scale so the row fills the container width. No mid-grid holes.
 */
export function packJustified({
  containerWidth,
  gap,
  items,
  idealHeight,
  captionBand = 0,
  minWidth,
}: {
  containerWidth: number;
  gap: number;
  items: JustifiedItem[];
  idealHeight?: number;
  captionBand?: number;
  minWidth?: number;
}): { placements: JustifiedPlacement[]; height: number } {
  const width = containerWidth;
  const empty = { placements: [] as JustifiedPlacement[], height: 0 };
  if (width <= 0 || items.length === 0) return empty;

  const ideal = idealHeight ?? masonryRowHeight(width);
  const floor = minWidth ?? masonryMinCard(width, gap);
  const placements: JustifiedPlacement[] = items.map(() => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }));
  const aspects = items.map((item) => clampAspect(item.aspect));

  let row: number[] = [];
  let rowAspect = 0;
  let y = 0;

  const flush = (indices: number[], lastRow: boolean) => {
    const n = indices.length;
    if (n === 0) return;
    const sum = indices.reduce((s, i) => s + (aspects[i] ?? FALLBACK_ASPECT), 0);
    const gaps = gap * Math.max(0, n - 1);
    const rawH = (width - gaps) / sum;
    let h = rawH;
    let fill = n > 1;
    if (n === 1) {
      const a = aspects[indices[0] ?? 0] ?? FALLBACK_ASPECT;
      if (a >= WIDE_ASPECT) {
        h = Math.min(rawH, width / a);
        fill = true;
      } else {
        h = Math.min(rawH, Math.max(ideal, floor / a));
        fill = false;
      }
    } else if (lastRow && rawH > ideal * 1.12) {
      let minH = ideal;
      for (const idx of indices) {
        const a = aspects[idx] ?? FALLBACK_ASPECT;
        minH = Math.max(minH, floor / a);
      }
      h = Math.min(rawH, minH);
      fill = h >= rawH - 0.5;
    }
    h = Math.max(80, Math.min(480, h));
    let x = 0;
    for (let k = 0; k < n; k += 1) {
      const i = indices[k] ?? 0;
      const a = aspects[i] ?? FALLBACK_ASPECT;
      let w = a * h;
      if (!fill && n === 1 && w < floor) {
        w = Math.min(floor, width);
        h = w / a;
      }
      if (fill && k === n - 1) w = Math.max(1, width - x);
      placements[i] = { x, y, width: Math.max(1, w), height: h };
      x += w + gap;
    }
    y += h + captionBand + gap;
  };

  for (let i = 0; i < items.length; i += 1) {
    const a = aspects[i] ?? FALLBACK_ASPECT;
    const nextCount = row.length + 1;
    const nextAspect = rowAspect + a;
    const nextGaps = gap * Math.max(0, nextCount - 1);
    const hIf = (width - nextGaps) / nextAspect;
    const tooNarrow = [...row, i].some((idx) => (aspects[idx] ?? FALLBACK_ASPECT) * hIf < floor);
    if (row.length > 0 && (hIf <= ideal || tooNarrow)) {
      if (tooNarrow) {
        flush(row, false);
        row = [i];
        rowAspect = a;
      } else {
        flush([...row, i], false);
        row = [];
        rowAspect = 0;
      }
    } else {
      row.push(i);
      rowAspect = nextAspect;
    }
  }
  flush(row, true);

  return { placements, height: y > 0 ? y - gap : 0 };
}
