/**
 * 请求 id 贯穿（M2 可观测性）。
 *
 * 作用：用 AsyncLocalStorage 存当前请求的短 id，服务端任意深度取用，
 *      不逐层传参。
 * 用法：入口（src/lib/next-route.ts 的 withDataPlane）生成 8 字符 id 后
 *      runWithRequestId(id, () => handler())；日志（log.server.ts 的 pino
 *      mixin）与响应头 X-Request-Id 从 getRequestId() 读。
 * 为什么：用户报障只给得出「刚刚点了一下就错了」；一条短 id 同时出现在
 *      响应头和全部日志行，对账从翻日志变成 grep。ALS 是唯一贯穿机制——
 *      服务端调用链太长，显式传参侵入面不可接受。
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
