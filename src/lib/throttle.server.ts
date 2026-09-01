/**
 * 从 kami.config.json 读控流。
 *
 * 作用：封面闸门、搜图间隔跟配置文件走。
 * 用法：getThrottle()；改文件后下次请求会按 mtime 重读。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveKamiRoot } from "./proxy.server";
import { DEFAULT_THROTTLE, parseThrottle, type ThrottleConfig } from "./throttle";

const CONFIG_REL = "kami.config.json";

let cached: { mtime: number; value: ThrottleConfig } | null = null;

export function getThrottle(root = resolveKamiRoot()): ThrottleConfig {
  const path = join(root, CONFIG_REL);
  let mtime = 0;
  try {
    if (existsSync(path)) mtime = statSync(path).mtimeMs;
  } catch {
    return DEFAULT_THROTTLE;
  }
  if (cached && cached.mtime === mtime) return cached.value;
  let parsed = DEFAULT_THROTTLE;
  try {
    parsed = parseThrottle(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    parsed = DEFAULT_THROTTLE;
  }
  cached = { mtime, value: parsed };
  return parsed;
}
