/**
 * 队列重试与并发策略（M6）。纯函数，单测在 queue-retry.test.ts。
 *
 * 退避：4s → 8s → 16s（最多 3 次尝试，封顶 30s）。
 * 用户态错误（要登录 / 订阅 / 内容不可用）重试无意义，直接判死。
 */
export const MAX_QUEUE_ATTEMPTS = 3;

// F6：与 classifyQueueError 的 unavailable 口径对齐——「不存在」（已删除作品）
// 是真实可达错误串，判死可重试集会把它白跑 3 次。
const NO_RETRY_PATTERN = /需要登录|需要有效订阅|需要订阅|不可用|被隐藏|返回类型异常|未知站点|不存在/;

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

// ── 失败分类与批量重试（X2，09-22-batch3-download-deploy）────────────────────

export type QueueErrorKind = "rate-limit" | "auth" | "unavailable" | "network" | "other";

/** 错误串语义分类（正则按优先级：限速 > 登录订阅 > 不可用 > 网络 > 其他）。 */
export function classifyQueueError(message: string): QueueErrorKind {
  if (/（429）|（503）|风控/.test(message)) return "rate-limit";
  if (/需要登录|需要有效订阅|需要订阅/.test(message)) return "auth";
  if (/不可用|被隐藏|返回类型异常|未知站点|不存在/.test(message)) return "unavailable";
  if (/fetch|网络|timeout|aborted|下载失败|请求失败/.test(message)) return "network";
  return "other";
}

export const QUEUE_ERROR_KIND_LABEL: Record<QueueErrorKind, string> = {
  "rate-limit": "上游限速",
  auth: "要登录 / 订阅",
  unavailable: "内容不可用",
  network: "网络失败",
  other: "其他",
};

/** 失败项里「可重试」的 key（用户态判死项不回炉）。 */
export function retryableKeys(items: { key: string; status: string; error?: string }[]): string[] {
  return items
    .filter((x) => x.status === "error" && typeof x.error === "string" && queueShouldRetry(x.error))
    .map((x) => x.key);
}
