/**
 * 案头轮播的帧序列纯函数。
 *
 * 作用：把一份池子切成轮播帧——铺纸 / 报纸按原顺序整块切（尾块不足整块丢弃，
 *      宁可少一帧也不凑数）；画师墙先洗牌再成批，每批都是随机抽样。
 * 用法：buildFrames(pool, size, rand, mode) 切帧；needsCarousel 判定够不够两帧；
 *      nextFrame 环形推进；sheetBatch / artistWallSize 给铺纸与墙算断点批量；
 *      marqueeDurationMs 给报纸 marquee 算单程时长。
 * 为什么：零 import、rand 可注入，node --test 里用确定性 LCG 断言洗牌与切块边界，
 *      不用把随机性放进组件测试。
 */

/** 切帧模式：sequential 保留原顺序（铺纸/报纸）；shuffle 先整池洗牌（画师墙）。 */
export type CarouselMode = "sequential" | "shuffle";

/**
 * 池 → 帧序列。
 *
 * sequential：按 pool 顺序切 size 一块，尾块不足整块时丢弃（10 张 size=4 → 2 帧）。
 * shuffle：先 Fisher–Yates 洗牌副本再切块（不改原池），块数同样是 floor(len/size)。
 * size < 1 视为非法，返回空（调用方走静态回退）。
 */
export function buildFrames<T>(
  pool: readonly T[],
  size: number,
  rand: () => number = Math.random,
  mode: CarouselMode = "sequential",
): T[][] {
  if (!Array.isArray(pool) || size < 1) return [];
  const source = mode === "shuffle" ? shuffleCopy(pool, rand) : pool;
  const frameCount = Math.floor(source.length / size);
  const frames: T[][] = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(source.slice(i * size, (i + 1) * size));
  }
  return frames;
}

/** frames 至少两帧才值得轮播；否则调用方静态展示首帧。 */
export function needsCarousel(frames: readonly unknown[] | undefined | null): boolean {
  return Array.isArray(frames) && frames.length >= 2;
}

/** 环形推进：越界回 0；len 异常时兜底 0，不抛错。 */
export function nextFrame(index: number, len: number): number {
  if (len <= 0) return 0;
  return (index + 1) % len;
}

/**
 * 铺纸的批大小：默认 4×2 = 8 格；2xl（≥1536px）起 6×3 = 18 格。
 * 池深恒 = 3 批，池随断点 24/54——大屏看到的是更多张数；三行把卡片下方
 * 被右栏（纸叠+墙）撑出来的留白填满。
 */
export function sheetBatch(is2xl: boolean): 8 | 18 {
  return is2xl ? 18 : 8;
}

/**
 * 画师墙的动态批量：clamp(floor(len / 3), 9, 上限)。
 * 池按 3 倍备帧（9 张一批 → 27 张起换 3 批），少则压到 9 保网格整齐，
 * 多则封上限免得一面墙太密；默认上限 12（3 列 × 4 行），2xl（4 列）放宽到
 * 16——当前池 cap 36 时 floor(36/3)=12 恰好 4 列 × 3 行，上限 16 给更厚的池留余量。
 */
export function artistWallSize(poolLen: number, is2xl = false): number {
  const cap = is2xl ? 16 : 12;
  return Math.min(cap, Math.max(9, Math.floor(poolLen / 3)));
}

/**
 * 报纸蛇形流动的节点数：路径（容器宽 + 节点宽）内按步距均分，环上相邻间距
 * 不小于步距——图片少蛇就短，图片多封顶到路径容量（换班走 slot 环 parade）。
 * step 非正或路径非正给 0（调用方走静态分支）。
 */
export function snakeNodeCount(itemCount: number, pathWidth: number, step: number): number {
  if (itemCount <= 0 || pathWidth <= 0 || step <= 0) return 0;
  return Math.min(itemCount, Math.floor(pathWidth / step));
}

/**
 * 蛇形尾迹透明度：蛇头（index 0）不透明，沿身体逐级线性衰减到尾部的下限
 * （默认 0.3——尾迹可辨但不抢头）。单节点恒 1。
 */
export function snakeOpacity(index: number, count: number, floor = 0.3): number {
  if (count <= 1) return 1;
  const t = Math.min(Math.max(index, 0), count - 1) / (count - 1);
  return 1 - (1 - floor) * t;
}

/** Fisher–Yates 洗牌副本；原池不动。 */
function shuffleCopy<T>(pool: readonly T[], rand: () => number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy;
}
