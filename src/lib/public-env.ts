/**
 * 读给浏览器看的 VITE_ 开关。
 *
 * 作用：Vite 走 import.meta.env；Next 把同名变量写进 process.env（next.config env）。
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
