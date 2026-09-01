/**
 * 判断请求是不是被取消，以及把上游流在取消时收干净。
 *
 * 作用：滚动、切页、关标签时浏览器会掐掉正在走的 `/api/media`。
 * 用法：if (isAbortError(err) || signal?.aborted) return 204；
 *      流式转发用 closeOnAbort(body, signal)。
 * 为什么：srvx 在 ServerResponse `close` 时 abort。handler 已经把 body 交出去之后，
 *        断开变成 h3 的 unhandled 500。把读流的 AbortError 收成正常 close，
 *        再在开发服把这类 console.error 滤掉，终端才不像崩了。
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

/**
 * 上游 ReadableStream 在客户端断开时 close，而不是 error。
 * 这样 h3 不会把管道中断写成未处理 500。
 */
export function closeOnAbort(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    void reader.cancel().catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  }
  return new ReadableStream({
    async pull(controller) {
      if (stopped || signal?.aborted) {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done || stopped || signal?.aborted) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        controller.error(err);
      }
    },
    cancel() {
      stop();
    },
  });
}

export function installAbortLogFilter(): void {
  const g = globalThis as typeof globalThis & { __kamiAbortLogFilter?: boolean };
  if (g.__kamiAbortLogFilter) return;
  g.__kamiAbortLogFilter = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args.some((arg) => isAbortError(arg))) return;
    orig(...args);
  };
}
