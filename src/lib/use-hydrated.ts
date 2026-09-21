/**
 * React 水合探针。
 *
 * 作用：水合首帧返回 false（与 SSR 同帧），完成后返回 true。
 * 用法：会话态这类「请求跑赢水合就会变」的展示——服务端渲染与水合首帧
 *      必须一致，否则 React 抛 hydration mismatch 整树重画（e2e 的
 *      pageerror 收集会红）。与 useSettingsHydrated 同一模式。
 * 为什么：better-auth 的 isPending 服务端恒为 true，客户端 get-session
 *      可能在水合前就回来；直接渲染 isPending 分支文本就是一场赛跑。
 */
import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => undefined;

export function useHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}
