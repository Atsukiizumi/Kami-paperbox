/**
 * 异步信号量（X1，09-22-batch3-download-deploy）。
 *
 * 作用：给多页并行下载守「同源在飞上限」——项并发 × 页并发的组合会到 16 在飞，
 *      闸到 6 对齐既有「每源 6 条连接」的礼貌口径（queue-retry.ts 注释同源）。
 * 用法：const gate = createSemaphore(6); const release = await gate.acquire(); ... release();
 * 为什么模块级共享单例：上限是对源站的全局承诺，不是每个作品的私有预算。
 */
export type Semaphore = {
  /** 取一个许可；超限时排队（FIFO）。resolve 的函数即 release。 */
  acquire: () => Promise<() => void>;
  /** 当前在飞数（测试观测用）。 */
  active: () => number;
};

export function createSemaphore(limit: number): Semaphore {
  if (limit < 1) limit = 1;
  let active = 0;
  const waiters: (() => void)[] = [];
  return {
    acquire() {
      return new Promise((resolve) => {
        const start = () => {
          active += 1;
          resolve(() => {
            active -= 1;
            const next = waiters.shift();
            if (next) next();
          });
        };
        if (active < limit) start();
        else waiters.push(start);
      });
    },
    active() {
      return active;
    },
  };
}
