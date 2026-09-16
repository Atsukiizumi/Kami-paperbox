"use client";

/**
 * 案头轮播的交叉淡换 hook。
 *
 * 作用：定时推进 frameIndex（setTimeout 链，暂停后恢复时重新起算整拍，不追赶），
 *      并把「当前帧 + 前一帧」一起交给调用方做双缓冲叠放——两层都渲染、
 *      奇偶各占一层，切换瞬间旧层 opacity→0、新层→1，避免卸载重挂的白闪。
 * 用法：const { frame, previousFrame, frameIndex, containerRef } =
 *        useCrossfade({ frames, intervalMs, urlsOf })；containerRef 挂在最外层
 *       容器上（IntersectionObserver 用），frames 请 useMemo（身份稳定才不重置节奏）。
 * 为什么：暂停三条件（document.hidden / 容器滚出视口 / 帧数不足两帧）任一成立
 *      就停表省电；prefers-reduced-motion 直接锁首帧不起定时器；下一帧图片用
 *      warmMedia（ProxiedImg 同款代理 URL + 媒体车道）预载，切换不空载。
 */

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { warmMedia } from "@/components/proxied-img";
import { needsCarousel, nextFrame } from "@/lib/desk-carousel";

export function useCrossfade<T>({
  frames,
  intervalMs,
  urlsOf,
}: {
  frames: readonly T[];
  intervalMs: number;
  /** 从一帧里取要预载的图片地址（ProxiedImg 的 src 口径，代理在 warmMedia 内做）。 */
  urlsOf?: (frame: T) => readonly (string | undefined)[];
}): {
  frame: T | undefined;
  previousFrame: T | undefined;
  frameIndex: number;
  containerRef: RefObject<HTMLElement | null>;
} {
  const containerRef = useRef<HTMLElement | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [inView, setInView] = useState(true);
  const [reduced, setReduced] = useState(false);

  // 系统「减弱动态效果」：锁首帧、不起定时器；监听变化即时生效。
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 页面不可见 → 停表。
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 容器滚出视口 → 停表。环境没有 IntersectionObserver（jsdom 等）当作可见。
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      setInView(Boolean(entry?.isIntersecting));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [containerRef]);

  // 数据刷新导致帧变少时收拢下标，别停在越界位置。
  useEffect(() => {
    setFrameIndex((i) => Math.min(i, Math.max(0, frames.length - 1)));
  }, [frames]);

  // 减弱动态效果开启期间始终回到首帧。
  useEffect(() => {
    if (reduced) setFrameIndex(0);
  }, [reduced]);

  const paused = !needsCarousel(frames) || hidden || !inView || reduced;

  // setTimeout 链：frameIndex 每推进一次重新起一拍；paused 翻转时清掉挂起的
  // 定时器，恢复后从恢复时刻重新起算整拍（不追赶暂停期间错过的帧）。
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => {
      setFrameIndex(nextFrame(frameIndex, frames.length));
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [paused, frameIndex, frames, intervalMs]);

  // 预载下一帧：切过去的瞬间图片已在 HTTP 缓存里，ProxiedImg 也认 warmThumbs。
  useEffect(() => {
    if (!needsCarousel(frames)) return;
    const upcoming = frames[nextFrame(frameIndex, frames.length)];
    if (!upcoming || !urlsOf) return;
    for (const url of urlsOf(upcoming)) warmMedia(url);
  }, [frameIndex, frames, urlsOf]);

  const safeIndex = frames.length === 0 ? 0 : Math.min(frameIndex, frames.length - 1);
  const frame = frames[safeIndex];
  const previousFrame =
    frames.length === 0 ? undefined : frames[(safeIndex - 1 + frames.length) % frames.length];

  return { frame, previousFrame, frameIndex: safeIndex, containerRef };
}
