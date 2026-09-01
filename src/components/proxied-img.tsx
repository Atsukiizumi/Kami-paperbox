/**
 * 走本站图片代理的 <img>。
 *
 * 作用：封面和作品页图。每张自己请求、自己亮。
 * 用法：封面 fit="cover"（默认）；作品页 / 灯箱 fit="contain" 才不会裁掉。
 * 为什么：pximg 直接给浏览器会 403。封面要铺满卡片，作品页要整张看见。
 *        已加载过的地址记在内存里，返回浏览不再闪扫光。
 *        失败会重试几次：并发一高代理会 204/429，一次 onError 不该把格子留空。
 */
import { useEffect, useRef, useState } from "react";
import { cn, mediaUrl } from "@/lib/utils";

const warmThumbs = new Set<string>();
const MAX_TRIES = 4;

function thumbKey(src: string) {
  return mediaUrl(src);
}

export function isMediaWarm(src: string | undefined) {
  return Boolean(src && warmThumbs.has(thumbKey(src)));
}

/** 预热代理图：写入 HTTP 缓存和内存集合，悬停预览才不会再扫一遍。 */
export function warmMedia(src: string | undefined) {
  if (!src || typeof Image === "undefined") return;
  const key = thumbKey(src);
  if (warmThumbs.has(key)) return;
  const img = new Image();
  img.decoding = "async";
  try {
    img.fetchPriority = "low";
  } catch {
    /* Safari 旧版 */
  }
  img.addEventListener("load", () => warmThumbs.add(key), { once: true });
  img.src = mediaUrl(src);
}

function inWarmBand(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return r.bottom > -800 && r.top < (typeof window === "undefined" ? 800 : window.innerHeight + 800);
}

export function ProxiedImg({
  src,
  alt,
  className,
  priority = false,
  sizes,
  fit = "cover",
  viewTransitionName,
  warmSrc,
}: {
  src?: string;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  fit?: "cover" | "contain";
  viewTransitionName?: string;
  warmSrc?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const [tryNo, setTryNo] = useState(0);
  const cached = Boolean(src && warmThumbs.has(thumbKey(src)));
  const [loaded, setLoaded] = useState(cached);
  const [active, setActive] = useState(priority || cached);
  const cover = fit === "cover";

  useEffect(() => {
    const hit = Boolean(src && warmThumbs.has(thumbKey(src)));
    setFailed(false);
    setTryNo(0);
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
    if (inWarmBand(host)) {
      setActive(true);
      return;
    }
    const arm = () => {
      if (inWarmBand(host)) {
        setActive(true);
        return true;
      }
      return false;
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setActive(true);
        io.disconnect();
      },
      { rootMargin: "800px 0px", threshold: 0 },
    );
    io.observe(host);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (arm()) {
        io.disconnect();
        ro?.disconnect();
      }
    });
    ro?.observe(host);
    return () => {
      io.disconnect();
      ro?.disconnect();
    };
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
        <span
          className={cn(
            "kami-shimmer pointer-events-none absolute inset-0",
            cover ? undefined : "min-h-40",
          )}
          aria-hidden
        />
      )}
      {active ? (
        <img
          key={tryNo}
          src={mediaUrl(src)}
          alt={alt}
          sizes={sizes}
          className={cn(
            "transition-[opacity,transform] duration-500 ease-out",
            cover ? "absolute inset-0 size-full object-cover" : "mx-auto h-auto w-full object-contain",
            loaded ? "scale-100 opacity-100" : "scale-[1.03] opacity-0",
            cover ? undefined : className,
          )}
          style={viewTransitionName ? { viewTransitionName } : undefined}
          loading="eager"
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => {
            warmThumbs.add(thumbKey(src));
            setLoaded(true);
            if (warmSrc) warmMedia(warmSrc);
          }}
          onError={() => {
            if (tryNo + 1 >= MAX_TRIES) {
              setFailed(true);
              return;
            }
            window.setTimeout(() => setTryNo((n) => n + 1), 400 * 2 ** tryNo);
          }}
        />
      ) : (
        <span className={cn("block", cover ? "size-full" : "min-h-40 w-full")} />
      )}
    </span>
  );
}
