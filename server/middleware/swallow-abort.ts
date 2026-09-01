/**
 * 生产（Nitro）把客户端断开收成 204。
 *
 * 作用：流式封面被掐时不要变成未处理 500。
 * 用法：server/middleware 自动挂上（vite.config serverDir）。
 * 为什么：dev 靠 swallow-abort-plugin 滤日志；部署走这条。
 */
import { isAbortError } from "../../src/lib/abort";

type EventLike = {
  req?: { signal?: AbortSignal };
};

export default async function swallowAbortMiddleware(
  event: EventLike,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  try {
    return await next();
  } catch (err) {
    if (isAbortError(err) || event.req?.signal?.aborted) {
      return new Response(null, { status: 204 });
    }
    throw err;
  }
}
