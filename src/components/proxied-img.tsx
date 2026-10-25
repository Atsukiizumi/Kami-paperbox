/**
 * 走本站图片代理的 <img>。
 *
 * 作用：封面和作品页图。每张自己请求、自己亮。
 * 用法：封面 fit="cover"（默认）；作品页 / 灯箱 fit="contain" 才不会裁掉。
 *      fallbackSrc（可选）= 高清未就绪时垫在下面的已缓存缩略图——只有它已经
 *      在内存热集合里才渲染，不发起绕过媒体车道的新请求。
 * 为什么：pximg 直接给浏览器会 403。封面要铺满卡片，作品页要整张看见。
 *        已加载过的地址记在内存里，返回浏览不再闪扫光。
 *        揭示走 150ms 纯淡入（kami-xfade，动效批 Task 3）：图片是内容不是
 *        玩具，不再整张缩放；缓存命中直接显示，不重播。
 *        失败会重试几次：并发一高代理会 204/429，一次 onError 不该把格子留空；
 *        高清彻底失败时保住 fallback，不露空白框。
 */
import { useEffect, useRef, useState } from "react";
import { acquireMediaLane } from "@/lib/media-lane";
import { isGifUrl } from "@/lib/thumb-url";
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
  if (isGifUrl(src)) return;
  const key = thumbKey(src);
  if (warmThumbs.has(key)) return;
  const release = acquireMediaLane(false);
  const img = new Image();
  img.decoding = "async";
  try {
    img.fetchPriority = "low";
  } catch {
    /* Safari 旧版 */
  }
  const done = () => release();
  img.addEventListener("load", () => {
    warmThumbs.add(key);
    done();
  }, { once: true });
  img.addEventListener("error", done, { once: true });
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
  fallbackSrc,
}: {
  src?: string;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  fit?: "cover" | "contain";
  viewTransitionName?: string;
  warmSrc?: string;
  /** 高清未就绪时的垫图：只在已进内存热集合时渲染（不新增网络请求）。 */
  fallbackSrc?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const [tryNo, setTryNo] = useState(0);
  const gif = isGifUrl(src);
  const cached = Boolean(src && !gif && warmThumbs.has(thumbKey(src)));
  const [loaded, setLoaded] = useState(cached);
  const [active, setActive] = useState(priority || cached);
  const [laneOpen, setLaneOpen] = useState(false);
  const releaseLaneRef = useRef<(() => void) | null>(null);
  const cover = fit === "cover";
  const fallbackWarm = Boolean(fallbackSrc && src && fallbackSrc !== src && !gif && warmThumbs.has(thumbKey(fallbackSrc)));

  function releaseLane() {
    releaseLaneRef.current?.();
    releaseLaneRef.current = null;
    setLaneOpen(false);
  }

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

  // 进入预热带后先占一条媒体车道（全局并发闸），拿到才挂 <img>；
  // load / error / 重试 / 卸载都会释放，连接让给后面的图和导航请求。
  useEffect(() => {
    if (!active || loaded) return;
    const release = acquireMediaLane(priority);
    releaseLaneRef.current = release;
    setLaneOpen(true);
    return () => {
      release();
      releaseLaneRef.current = null;
    };
  }, [active, priority, tryNo, loaded]);

  if (!src) {
    return (
      <div
        className={cn("flex items-center justify-center bg-elevated text-subtle", className)}
        aria-hidden
      />
    );
  }

  // 高清彻底失败：热缩略图还在就保住它，不露空白框
  if (failed) {
    if (!fallbackWarm) {
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
        className={cn("relative block bg-elevated", cover ? "size-full overflow-hidden" : "w-full")}
      >
        <img
          src={mediaUrl(fallbackSrc)}
          alt={alt}
          className={cn(cover ? "absolute inset-0 size-full object-cover" : "mx-auto h-auto w-full object-contain", cover ? className : undefined)}
        />
      </span>
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
      {/* 垫图在主图下面：高清淡入换上的瞬间不露底（只渲染已热的，不发新请求） */}
      {!loaded && fallbackWarm ? (
        <img
          src={mediaUrl(fallbackSrc)}
          alt=""
          aria-hidden
          className={cover ? "absolute inset-0 size-full object-cover" : "mx-auto h-auto w-full object-contain"}
        />
      ) : null}
      {loaded || fallbackWarm ? null : (
        <span
          className={cn(
            "kami-shimmer pointer-events-none absolute inset-0",
            cover ? undefined : "min-h-40",
          )}
          aria-hidden
        />
      )}
      {active && (laneOpen || loaded) ? (
        <img
          key={tryNo}
          src={mediaUrl(src)}
          alt={alt}
          sizes={sizes}
          className={cn(
            "kami-img-reveal",
            cover ? "absolute inset-0 size-full object-cover" : "mx-auto h-auto w-full object-contain",
            loaded || gif ? "opacity-100" : "opacity-0",
            cover ? undefined : className,
          )}
          style={viewTransitionName ? { viewTransitionName } : undefined}
          loading="eager"
          fetchPriority={priority ? "high" : "auto"}
          decoding={gif ? "sync" : "async"}
          onLoad={() => {
            warmThumbs.add(thumbKey(src));
            setLoaded(true);
            releaseLane();
            if (warmSrc) warmMedia(warmSrc);
          }}
          onError={() => {
            releaseLane();
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
