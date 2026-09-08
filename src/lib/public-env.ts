/**
 * 读给浏览器看的 VITE_ 开关。
 *
 * 作用：Next 把 `VITE_*` 写进 process.env（next.config env）。名字仍叫 VITE_ 是历史兼容。
 * 用法：publicEnv("VITE_AUTH_ENABLED") !== "false"
 */
export function publicEnv(name: string): string | undefined {
  if (typeof process !== "undefined") {
    const value = process.env?.[name];
    if (typeof value === "string") return value;
  }
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const value = env?.[name];
    if (typeof value === "string") return value;
  } catch {
    /* 部分打包器没有 import.meta.env */
  }
  return undefined;
}
