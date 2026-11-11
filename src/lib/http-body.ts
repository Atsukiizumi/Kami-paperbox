/**
 * 数据面请求体大小。
 *
 * Content-Length 超过上限时在读 body 之前拒绝。没有这个头的分块请求
 * 在读取时按同一上限截断。同步 2MB、搜图 8MB 仍由各路由自己再卡一层。
 */
export const DATA_PLANE_MAX_BYTES = 64 * 1024 * 1024;

export type BodySizeVerdict = "ok" | "invalid" | "too-large";

export function bodySizeVerdict(method: string, contentLength: string | null, max = DATA_PLANE_MAX_BYTES): BodySizeVerdict {
  if (method === "GET" || method === "HEAD") return "ok";
  if (contentLength === null || contentLength === "") return "ok";
  if (!/^\d+$/.test(contentLength)) return "invalid";
  const n = Number(contentLength);
  if (!Number.isSafeInteger(n)) return "invalid";
  return n > max ? "too-large" : "ok";
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("请求体太大");
    this.name = "BodyTooLargeError";
  }
}

/** 读 body 时按字节截断。没有 Content-Length 的分块请求也走这里。 */
export function capRequestBody(request: Request, max = DATA_PLANE_MAX_BYTES): Request {
  if (!request.body || request.method === "GET" || request.method === "HEAD") return request;
  const reader = request.body.getReader();
  let seen = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        seen += value.byteLength;
        if (seen > max) {
          controller.error(new BodyTooLargeError());
          await reader.cancel().catch(() => undefined);
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Request(request, { body: stream, duplex: "half" } as RequestInit);
}
