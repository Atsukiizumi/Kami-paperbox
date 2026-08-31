import { useState } from "react";
import { cn, mediaUrl } from "@/lib/utils";

export function ProxiedImg({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
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
      className={cn("bg-elevated object-cover", className)}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
