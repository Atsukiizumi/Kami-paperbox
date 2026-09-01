/**
 * 判断请求是不是被取消。
 *
 * 作用：滚动、切页、关标签时浏览器会掐掉正在走的 `/api/media`。
 * 用法：if (isAbortError(err) || signal?.aborted) return 204。
 * 为什么：srvx 把客户端断开写成 AbortError / ECONNRESET 再报 500，看起来像程序崩了。
 *        流式转发已经把 body 交出去之后，断开发生在 handler 外面，控制台仍可能打一行，
 *        那是传输中断，不是业务错误。
 */
export function isAbortError(error: unknown): boolean {
  return isAbortErrorInner(error, 0);
}

function isAbortErrorInner(error: unknown, depth: number): boolean {
  if (!error || depth > 4) return false;
  if (typeof error !== "object") return false;
  const err = error as { name?: string; message?: string; code?: string; cause?: unknown };
  if (err.name === "AbortError") return true;
  if (err.code === "ECONNRESET" || err.code === "ECONNABORTED" || err.code === "ABORT_ERR") return true;
  if (typeof err.message === "string") {
    if (/operation was aborted/i.test(err.message)) return true;
    if (/^(aborted|abort)$/i.test(err.message.trim())) return true;
  }
  if (err.cause && err.cause !== error) return isAbortErrorInner(err.cause, depth + 1);
  return false;
}
