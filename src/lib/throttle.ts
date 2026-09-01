/**
 * 控流配置（kami.config.json 的 throttle）。
 *
 * 作用：封面并发、429 重试、搜图间隔都从这里读。
 * 用法：parseThrottle(json)；服务端 getThrottle() 读文件。
 * 为什么：pximg 一紧就要把并发降到 3，一松可以加到 10。写进配置文件，
 *        不要改代码。改完保存即生效（按文件 mtime 重读）。
 */
import type { SearchEngine } from "./reverse-search";

export type ThrottleConfig = {
  mediaConcurrency: number;
  mediaRetry: number;
  mediaRetryMs: number;
  search: Record<SearchEngine, number>;
};

export const DEFAULT_THROTTLE: ThrottleConfig = {
  mediaConcurrency: 6,
  mediaRetry: 1,
  mediaRetryMs: 500,
  search: {
    saucenao: 8_000,
    ascii2d: 15_000,
    iqdb: 6_000,
    tineye: 12_000,
  },
};

function clamp(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseThrottle(raw: unknown): ThrottleConfig {
  const root = asRecord(raw);
  const t = asRecord(root.throttle);
  const searchIn = asRecord(t.search ?? root.search);
  const search = { ...DEFAULT_THROTTLE.search };
  for (const engine of Object.keys(search) as SearchEngine[]) {
    const n = Number(searchIn[engine]);
    if (Number.isFinite(n)) search[engine] = clamp(n, 500, 120_000, search[engine]);
  }
  return {
    mediaConcurrency: clamp(Number(t.mediaConcurrency), 1, 32, DEFAULT_THROTTLE.mediaConcurrency),
    mediaRetry: clamp(Number(t.mediaRetry), 0, 5, DEFAULT_THROTTLE.mediaRetry),
    mediaRetryMs: clamp(Number(t.mediaRetryMs), 100, 10_000, DEFAULT_THROTTLE.mediaRetryMs),
    search,
  };
}
