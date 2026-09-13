/**
 * 滚轮切页（多 P 预览）纯逻辑。
 *
 * 作用：把 wheel deltaY 翻译成翻页方向——带阈值（触控板微动不翻页）和
 *      时间锁（惯性滚动连发不狂翻）、循环取模。
 * 用法：artwork-card 在大预览打开时把原生 wheel 事件交给 wheelDir/wrapPage。
 * 为什么单独成文件：阈值/锁/循环是纯决策，node:test 直测；事件接线保持薄。
 */

/** 单次翻转的时间锁（毫秒）：触控板惯性一次能连发几十个 wheel 事件。 */
export const PAGE_FLIP_LOCK_MS = 140;
/** 触发翻页的最小 deltaY（触控板微移忽略）。 */
export const PAGE_FLIP_MIN_DELTA = 8;

/**
 * deltaY → 方向：1 = 下滚（下一页），-1 = 上滚（上一页），0 = 忽略
 * （幅度不足或处于时间锁内）。
 */
export function wheelDir(deltaY: number, lastFlipAt: number, now: number): 0 | 1 | -1 {
  if (now - lastFlipAt < PAGE_FLIP_LOCK_MS) return 0;
  if (Math.abs(deltaY) < PAGE_FLIP_MIN_DELTA) return 0;
  return deltaY > 0 ? 1 : -1;
}

/** 循环取页：dir 正负皆可，count <= 1 时原样返回。 */
export function wrapPage(current: number, dir: 0 | 1 | -1, count: number): number {
  if (count <= 1 || dir === 0) return current;
  return (current + dir + count) % count;
}
