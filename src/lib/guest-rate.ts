/**
 * 账号开启时，未登录访客打公开接口的进程内限额。
 *
 * 不按 X-Forwarded-For 分桶：服务直接暴露在局域网上，这个头可以伪造。
 * 已登录会话不计入。账号关闭（局域网令牌）的形态不走这里。
 */
export const GUEST_WINDOW_MS = 60_000;
export const GUEST_SOURCE_LIMIT = 60;
export const GUEST_MEDIA_LIMIT = 600;
export const GUEST_RANKINGS_LIMIT = 30;
/** 会话写入（访客只写自己的 cookie 镜像）：粘贴 / 重试类突发，30 足够。 */
export const GUEST_SESSIONS_LIMIT = 30;

type Bucket = { start: number; count: number };

const buckets = new Map<string, Bucket>();

export function allowGuest(bucket: string, limit: number, now = Date.now(), windowMs = GUEST_WINDOW_MS): boolean {
  const current = buckets.get(bucket);
  if (!current || now - current.start >= windowMs) {
    buckets.set(bucket, { start: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function resetGuestRatesForTests(): void {
  buckets.clear();
}
