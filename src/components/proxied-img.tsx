/**
 * 走本站图片代理的 <img>。
 *
 * 作用：给封面和作品页图。每张图自己请求、自己亮，不等一批齐。
 * 用法：首屏几张 priority；其余进视口附近才开始拉。
 * 为什么：pximg 直接给浏览器会 403。以前前 8 张 eager、后面 lazy，
 *        看起来像攒够数量才出图。现在谁先到谁先显示。
 */
import { useEffect, useRef, useState } from "react";
import { cn, mediaUrl } from "@/lib/utils";

export function ProxiedImg({
  src,
  alt,
  className,
  priority = false,
  sizes,
}: {
  src?: string;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(priority);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setActive(priority);
  }, [src, priority]);

  useEffect(() => {
    if (!src || priority || active) return;
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setActive(true);
        io.disconnect();
      },
      { rootMargin: "800px 0px", threshold: 0.01 },
    );
    io.observe(host);
    return () => io.disconnect();
  }, [src, priority, active]);

  if (!src || failed) {
    return (
      <div
        className={cn("flex items-center justify-center bg-elevated text-subtle", className)}
        aria-hidden
      />
    );
  }

  return (
    <span ref={hostRef} className="relative block size-full overflow-hidden bg-elevated">
      {loaded ? null : <span className="kami-shimmer pointer-events-none absolute inset-0" aria-hidden />}
      {active ? (
        <img
          src={mediaUrl(src)}
          alt={alt}
          sizes={sizes}
          className={cn(
            "relative size-full object-cover transition-opacity duration-200 ease-out",
            loaded ? "opacity-100" : "opacity-0",
            className,
          )}
          loading="eager"
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
