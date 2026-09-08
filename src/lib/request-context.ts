/**
 * 当前 HTTP 请求。Next Route Handler 和 Vite server fn 都能读到。
 *
 * 作用：把 Request 放进 AsyncLocalStorage，auth / cookie 不必再绑 TanStack getRequest。
 * 用法：Route Handler 里 runWithRequest(request, () => handler(request))。
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<Request>();

export function runWithRequest<T>(request: Request, fn: () => T): T {
  return storage.run(request, fn);
}

export function getActiveRequest(): Request | undefined {
  return storage.getStore();
}

export function readRequestCookie(request: Request | undefined, name: string): string | null {
  if (!request) return null;
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}
