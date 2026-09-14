/**
 * 上游健康环形缓冲（M2 可观测性）。
 *
 * 作用：出站层（curl-fetch.server.ts）每个出站尝试结束后记一条
 *      {ok, ms, at}，每 host 只留最近 50 条；getUpstreamHealth() 给出
 *      每 host 的调用数 / 成功率 / p50 延迟 / 最近一次失败。
 * 用法：recordUpstreamHit 只该在出站层调用（成功/失败返回点）；
 *      /api/health/upstream（会话闸，guest 不放行）读聚合给设置页卡片。
 * 为什么：报障时用户只说「图加载不出来」，这里能直接看出是哪个站慢、
 *      哪个站连续报错。纯内存环形、无 IO、无持久化——读路径零成本，
 *      fetch 行为零变化；进程重启归零是可接受的（健康是当下状态）。
 */

const RING_SIZE = 50;

export type UpstreamHit = {
  ok: boolean;
  ms: number;
  at: number;
  /** ok=false 时的失败原因（HTTP xxx / 传输错误消息）。 */
  error?: string;
};

export type UpstreamHostHealth = {
  host: string;
  calls: number;
  /** 0..1。4xx/5xx 计失败：401（Cookie 失效）/429（风控）正是用户要看的健康信号。 */
  okRate: number;
  p50Ms: number;
  lastError: string | null;
  lastErrorAt: number | null;
};

const rings = new Map<string, UpstreamHit[]>();

export function recordUpstreamHit(
  host: string,
  ok: boolean,
  ms: number,
  detail: { at?: number; error?: string } = {},
): void {
  if (!host) return;
  let ring = rings.get(host);
  if (!ring) {
    ring = [];
    rings.set(host, ring);
  }
  const at = detail.at ?? Date.now();
  ring.push(ok ? { ok, ms, at } : { ok, ms, at, error: detail.error ?? "unknown" });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}

/** 偶数取中间两数均值，避免 p50 随样本顺序抖动。 */
function medianMs(durations: number[]): number {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function getUpstreamHealth(): { hosts: UpstreamHostHealth[] } {
  const hosts = [...rings.keys()].sort();
  return {
    hosts: hosts.map((host) => {
      const ring = rings.get(host) ?? [];
      const oks = ring.reduce((n, hit) => n + (hit.ok ? 1 : 0), 0);
      let lastError: string | null = null;
      let lastErrorAt: number | null = null;
      for (let i = ring.length - 1; i >= 0; i -= 1) {
        if (!ring[i].ok) {
          lastError = ring[i].error ?? "unknown";
          lastErrorAt = ring[i].at;
          break;
        }
      }
      return {
        host,
        calls: ring.length,
        okRate: ring.length ? oks / ring.length : 0,
        p50Ms: medianMs(ring.map((hit) => hit.ms)),
        lastError,
        lastErrorAt,
      };
    }),
  };
}

/** 测试用：清空内存环。 */
export function resetUpstreamHealthForTest(): void {
  rings.clear();
}
