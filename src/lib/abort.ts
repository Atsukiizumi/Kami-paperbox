/**
 * 判断请求是不是被取消。
 *
 * 作用：滚动、切页、关标签时浏览器会 abort 正在走的 /api/media。
 * 用法：if (isAbortError(err) || signal?.aborted) return 204。
 * 为什么：srvx 把客户端断开写成 AbortError 再报 500，看起来像程序崩了。
 */
export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError") {
    return true;
  }
  if (error instanceof Error && /operation was aborted/i.test(error.message)) return true;
  return false;
}
