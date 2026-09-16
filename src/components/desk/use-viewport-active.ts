"use client";

/**
 * 案头动效的视口活跃 hook。
 *
 * 作用：监听「页面不可见（document.hidden）」与「容器滚出视口（IntersectionObserver）」，
 *      任一成立返回 active=false——marquee 据此切 animation-play-state，
 *      use-crossfade 据此停表。环境没有 IntersectionObserver（jsdom 等）当作可见。
 * 用法：const { ref, active } = useViewportActive<HTMLElement>()；ref 挂容器，
 *      容器允许迟到（数据到了才渲染）：回调 ref 落地后观察器自动补挂。
 * 为什么：暂停的这两个条件在交叉淡换与 marquee 间是同一套（节能 + 礼貌），
 *      抽成共享小 hook 免得两处各养一份监听。
 */

import { useCallback, useEffect, useState } from "react";

export function useViewportActive<E extends HTMLElement>(): {
  /** 回调 ref（挂在容器上）；容器迟到挂载时，元素进 state 让观察器 effect 补挂。 */
  ref: (node: E | null) => void;
  active: boolean;
} {
  const [element, setElement] = useState<E | null>(null);
  const ref = useCallback((node: E | null) => setElement(node), []);
  const [hidden, setHidden] = useState(false);
  const [inView, setInView] = useState(true);

  // 页面不可见 → 不活跃。
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 容器滚出视口 → 不活跃；元素卸下时收掉并回到可见（下次挂载重新观察）。
  // 没有 IntersectionObserver 的环境（jsdom 等）当作可见。
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      setInView(Boolean(entry?.isIntersecting));
    });
    io.observe(element);
    return () => {
      io.disconnect();
      setInView(true);
    };
  }, [element]);

  return { ref, active: !hidden && inView };
}
