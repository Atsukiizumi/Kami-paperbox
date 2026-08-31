/**
 * 走本站图片代理的 <img>。
 *
 * 作用：给封面和作品页图；首屏几张 eager，其余 lazy。
 * 为什么：pximg 直接给浏览器会 403；首屏再 lazy 会白白空一截。
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
    <img
      src={mediaUrl(src)}
      alt={alt}
      sizes={sizes}
      className={cn(
        "bg-elevated object-cover transition-opacity duration-200 ease-out",
        loaded ? "opacity-100" : "opacity-0",
        className,
      )}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
