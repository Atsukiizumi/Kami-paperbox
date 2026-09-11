/**
 * 队列重试与并发策略（M6）。纯函数，单测在 queue-retry.test.ts。
 *
 * 退避：4s → 8s → 16s（最多 3 次尝试，封顶 30s）。
 * 用户态错误（要登录 / 订阅 / 内容不可用）重试无意义，直接判死。
 */
export const MAX_QUEUE_ATTEMPTS = 3;

const NO_RETRY_PATTERN = /需要登录|需要有效订阅|需要订阅|不可用|被隐藏|返回类型异常|未知站点/;

export function queueShouldRetry(message: string): boolean {
  return !NO_RETRY_PATTERN.test(message);
}

export function queueBackoffMs(attempts: number): number {
  return Math.min(4000 * 2 ** Math.max(0, attempts - 1), 30_000);
}

/** 并发上限 4：再多会对同一源站打太狠（HTTP/1.1 每源 6 条连接）。 */
export function clampQueueConcurrency(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.min(4, Math.max(1, n));
}
