/**
 * 429/503 自适应降档（X4，09-22-batch3-download-deploy）。
 *
 * 作用：上游限速时全局降并发（-2 档、下限 1）冷却 90s，到期自动恢复原设置。
 * 用法：项失败且错误命中 rateLimitError() → noteRateLimit()；worker 取件前用
 *      effectiveConcurrency(setting) 决定本波处理位数。
 * 为什么内存态不写设置：限速是突发状态，落盘会忘了恢复；刷新即回全速是安全侧。
 */
export const RATE_LIMIT_COOL_DOWN_MS = 90_000;

/** 限速类错误判定（与 classifyQueueError 的 rate-limit 同口径）。 */
export function rateLimitError(message: string): boolean {
  return /（429）|（503）|风控/.test(message);
}

let coolDownUntil = 0;

export function noteRateLimit(now = Date.now()): void {
  coolDownUntil = now + RATE_LIMIT_COOL_DOWN_MS;
}

/** 冷却期内 = max(1, setting-2)；期外 = setting 原样。 */
export function effectiveConcurrency(setting: number, now = Date.now()): number {
  if (now >= coolDownUntil) return setting;
  return Math.max(1, setting - 2);
}

/** 测试复位（生产不引用）。 */
export function resetRateLimitCoolDown(): void {
  coolDownUntil = 0;
}
