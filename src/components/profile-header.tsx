/**
 * 画师 / 创作者页头。
 *
 * 作用：圆头像铺满，过长简介先夹三行，用户点开再展开。
 * 用法：ProfileAvatar + FoldableText 拼在页头。
 * 为什么：封面图的 shimmer 带 min-h-40，套进小圆会把头像挤到一角。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ProxiedImg } from "./proxied-img";

export function ProfileAvatar({
  src,
  name,
}: {
  src?: string;
  name: string;
}) {
  return (
    <div className="relative size-24 shrink-0 overflow-hidden rounded-full bg-elevated shadow-[var(--shadow-border)] md:size-32">
      {src ? (
        <ProxiedImg src={src} alt={name} fit="cover" className="absolute inset-0 size-full" />
      ) : (
        <span className="flex size-full items-center justify-center font-display text-2xl text-muted">
          {name.slice(0, 1) || "?"}
        </span>
      )}
    </div>
  );
}

export function FoldableText({
  text,
  lines = 3,
  className,
}: {
  text: string;
  lines?: number;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [foldable, setFoldable] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setFoldable(el.scrollHeight > el.clientHeight + 2);
  }, [text, open, lines]);

  if (!text.trim()) return null;
  return (
    <div className={className}>
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap break-words text-sm leading-relaxed text-muted",
          !open && (lines <= 3 ? "line-clamp-3" : "line-clamp-4"),
        )}
      >
        {text}
      </p>
      {foldable || open ? (
        <button
          type="button"
          className="mt-1 text-xs text-fg/80 transition-colors hover:text-fg"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起简介" : "展开简介"}
        </button>
      ) : null}
    </div>
  );
}
