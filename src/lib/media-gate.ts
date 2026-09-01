/**
 * 出站图片并发闸。
 *
 * 作用：同一时刻只让有限条 pximg 请求在飞，多出来的排队。
 * 用法：await withMediaGate(() => outboundFetch(...), signal)。
 * 为什么：浏览页几十张封面 + 预热大图会一起打 i.pximg.net，容易 429，
 *        浏览器对 /api/media 又几乎不限并发（HTTP/2）。
 */
const LIMIT = 6;
let active = 0;
const waiters: Array<() => void> = [];

export function mediaGateActive() {
  return active;
}

function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  if (active < LIMIT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const resume = () => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      active += 1;
      resolve();
    };
    const onAbort = () => {
      const i = waiters.indexOf(resume);
      if (i >= 0) waiters.splice(i, 1);
      reject(new DOMException("aborted", "AbortError"));
    };
    waiters.push(resume);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

export async function withMediaGate<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await acquire(signal);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function sleep(ms: number, signal?: AbortSignal) {
  if (!ms) return;
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
