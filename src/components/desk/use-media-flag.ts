"use client";

/**
 * 断点 matchMedia 布尔旗标。
 *
 * 作用：把一条 matchMedia 查询读成响应式 boolean——初始 SSR / 无 matchMedia
 *      环境安全给默认值 false，挂载后同步真实值并监听 change（断点翻转即时生效），
 *      卸载清理监听器。
 * 用法：const is2xl = useMediaFlag("(min-width: 1536px)")。
 * 为什么：案头大屏适配的列数 / 批大小随断点翻，matchMedia 比 resize 监听省电
 *      也省得自己算阈值；翻转会让 frames useMemo 重算（轮播节奏重置一次），
 *      断点切换本就是大事件，可接受。
 */

import { useEffect, useState } from "react";

export function useMediaFlag(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
