/**
 * 走本站图片代理的 <img>。
 *
 * 作用：封面和作品页图。每张自己请求、自己亮。
 * 用法：封面 fit="cover"（默认）；作品页 / 灯箱 fit="contain" 才不会裁掉。
 * 为什么：pximg 直接给浏览器会 403。封面要铺满卡片，作品页要整张看见。
 *        已加载过的地址记在内存里，返回浏览不再闪扫光。
 */
import { useEffect, useRef, useState } from "react";
import { cn, mediaUrl } from "@/lib/utils";

const warmThumbs = new Set<string>();

function thumbKey(src: string) {
  return mediaUrl(src);
}

export function ProxiedImg({
  src,
  alt,
  className,
  priority = false,
  sizes,
  fit = "cover",
}: {
  src?: string;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  fit?: "cover" | "contain";
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const cached = Boolean(src && warmThumbs.has(thumbKey(src)));
  const [loaded, setLoaded] = useState(cached);
  const [active, setActive] = useState(priority || cached);
  const cover = fit === "cover";

  useEffect(() => {
    const hit = Boolean(src && warmThumbs.has(thumbKey(src)));
    setFailed(false);
    setLoaded(hit);
    setActive(priority || hit);
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
    <span
      ref={hostRef}
      className={cn(
        "relative bg-elevated",
        cover ? "block size-full overflow-hidden" : "block w-full",
        cover ? className : undefined,
      )}
    >
      {loaded ? null : (
        <span className="kami-shimmer pointer-events-none absolute inset-0 min-h-40" aria-hidden />
      )}
      {active ? (
        <img
          src={mediaUrl(src)}
          alt={alt}
          sizes={sizes}
          className={cn(
            "transition-opacity duration-200 ease-out",
            cover ? "size-full object-cover" : "mx-auto h-auto w-full object-contain",
            loaded ? "opacity-100" : "opacity-0",
            cover ? undefined : className,
          )}
          loading="eager"
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => {
            warmThumbs.add(thumbKey(src));
            setLoaded(true);
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block min-h-40 w-full" />
      )}
    </span>
  );
}
