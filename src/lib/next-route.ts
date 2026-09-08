/**
 * Next Route Handler 包一层当前 Request，给 auth / cookie 读。
 */
import { runWithRequest } from "./request-context.ts";

export function withRequest<T>(fn: (request: Request) => T): (request: Request) => T {
  return (request: Request) => runWithRequest(request, () => fn(request));
}
