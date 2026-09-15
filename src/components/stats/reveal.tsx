"use client";

/**
 * 统计页进场渐显（动效批 D 的 data-inview 同款语义）。
 *
 * 作用：统计页的分区卡片进视口才从下方 14px 淡入，滚动时一层层落纸。
 * 用法：<Reveal className="grid …">…卡片…</Reveal>。
 * 为什么：masonry 的 data-inview 约定是它模块私有的（CSS 选择器也只挂在
 *        [data-packed] 容器内），这里独立复刻同一行为；只用 transform/opacity，
 *        motion-reduce 归零，不新增 keyframes（styles.css 零改动）。
 *        IO hook 不导出（react-refresh 要求客户端文件只出组件），
 *        需要复用时再抽独立文件。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function useInView<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, inView];
}

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,translate] duration-500 ease-out motion-reduce:transition-none",
        inView ? "translate-y-0 opacity-100" : "translate-y-3.5 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
