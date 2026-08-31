/**
 * 走本站图片代理的 <img>。
 *
 * 作用：给封面和作品页图；首屏几张 eager，其余 lazy。未完成时底下走 shimmer。
 * 为什么：pximg 直接给浏览器会 403；代理很慢，空灰块看起来像坏了。
 */
import { useState } from "react";
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
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={cn("flex items-center justify-center bg-elevated text-subtle", className)}
        aria-hidden
      />
    );
  }
  return (
    <span className="relative block size-full overflow-hidden bg-elevated">
      {loaded ? null : <span className="kami-shimmer pointer-events-none absolute inset-0" aria-hidden />}
      <img
        src={mediaUrl(src)}
        alt={alt}
        sizes={sizes}
        className={cn(
          "relative size-full object-cover transition-opacity duration-200 ease-out",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
