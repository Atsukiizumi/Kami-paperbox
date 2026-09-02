/**
 * 滚到底自动加载下一页。
 *
 * 作用：榜单 / 搜索 / FANBOX 往下加页，不再点「下一页」。
 * 用法：列表下面 <InfiniteSentinel disabled={!hasNext} onVisible={fetchNext} />。
 * 为什么：页码按钮会把已看过的网格换掉；哨兵进视口再请求，上面的卡片还在。
 */
import { useEffect, useRef } from "react";
import { PaperMark } from "./paper-mark";

export function InfiniteSentinel({
  disabled,
  onVisible,
}: {
  disabled?: boolean;
  onVisible: () => void;
}) {
  const cb = useRef(onVisible);
  cb.current = onVisible;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) cb.current();
      },
      { rootMargin: "720px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled]);

  if (disabled) return null;
  return (
    <div ref={ref} className="flex h-16 items-center justify-center text-muted">
      <PaperMark busy className="size-5" />
    </div>
  );
}
