/**
 * Dev 时不要把客户端断开打成 Vite SSR 500。
 *
 * 作用：h3 在 prepareResponse 里先 console.error 再走 onError，流式 /api/media
 *      被掐掉时终端会刷 AbortError。这里滤掉这类日志。
 * 用法：vite.config.ts plugins 里、tanstackStart 之前。
 * 为什么：断开发生在 handler 把 body 交出去之后，路由 catch 够不着。
 */
function isAbortLog(error, depth = 0) {
  if (!error || depth > 4 || typeof error !== "object") return false;
  if (error.name === "AbortError") return true;
  if (error.code === "ECONNRESET" || error.code === "ECONNABORTED" || error.code === "ABORT_ERR") {
    return true;
  }
  if (typeof error.message === "string") {
    if (/operation was aborted/i.test(error.message)) return true;
    if (/^(aborted|abort)$/i.test(error.message.trim())) return true;
  }
  if (error.cause && error.cause !== error) return isAbortLog(error.cause, depth + 1);
  return false;
}

export function swallowAbortPlugin() {
  return {
    name: "kami-swallow-abort",
    apply: "serve",
    configureServer() {
      if (globalThis.__kamiAbortLogFilter) return;
      globalThis.__kamiAbortLogFilter = true;
      const orig = console.error.bind(console);
      console.error = (...args) => {
        if (args.some((arg) => isAbortLog(arg))) return;
        orig(...args);
      };
    },
  };
}
