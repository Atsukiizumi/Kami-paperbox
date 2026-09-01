import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UgoiraFrame } from "@/lib/ugoira-meta";
import { cn } from "@/lib/utils";
import { UgoiraPlayer } from "./ugoira-player";

export type LightboxItem = {
  src: string;
  alt: string;
  caption?: string;
  ugoira?: { zipUrl: string; frames: UgoiraFrame[] };
};

export function ImageLightbox({
  items,
  index,
  open,
  onClose,
  onIndex,
  originUrl,
  footer,
}: {
  items: LightboxItem[];
  index: number;
  open: boolean;
  onClose: () => void;
  onIndex: (i: number) => void;
  originUrl?: string;
  footer?: ReactNode;
}) {
  const [shown, setShown] = useState(open);
  const [visible, setVisible] = useState(open);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (open) {
      setShown(true);
      const id = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setShown(false), 300);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [index, open]);

  useEffect(() => {
    if (!shown || items.length < 2) return;
    const el = document.querySelector<HTMLElement>(`[data-strip="${index}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index, shown, items.length]);

  useEffect(() => {
    if (!shown) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndex((index - 1 + items.length) % items.length);
      if (e.key === "ArrowRight") onIndex((index + 1) % items.length);
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(5, s + 0.25));
      if (e.key === "-") setScale((s) => Math.max(1, s - 0.25));
      if (e.key === "0") {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [shown, index, items.length, onClose, onIndex]);

  if (!shown || items.length === 0) return null;
  const item = items[index];
  if (!item) return null;

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (scale > 1) {
      setOffset({ x: d.ox + dx, y: d.oy + dy });
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    if (scale > 1) return;
    if (items.length < 2) return;
    const dx = e.clientX - d.x;
    if (dx > 50) onIndex((index - 1 + items.length) % items.length);
    if (dx < -50) onIndex((index + 1) % items.length);
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-overlay transition-opacity duration-300 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="大图预览"
      onClick={onClose}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-2">
        <p className="px-2 text-sm tabular-nums text-muted">
          {index + 1} / {items.length}
          {item.caption ? ` · ${item.caption}` : ""}
        </p>
        {originUrl ? (
          <a
            href={originUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1 rounded-sm px-2 text-sm text-muted hover:bg-elevated hover:text-fg"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3.5" />
            原始链接
          </a>
        ) : null}
        <div className="ml-auto flex items-center">
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-sm text-fg hover:bg-elevated"
            aria-label="缩小"
            onClick={(e) => {
              e.stopPropagation();
              setScale((s) => Math.max(1, s - 0.25));
            }}
          >
            <ZoomOut className="size-5" />
          </button>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-sm text-fg hover:bg-elevated"
            aria-label="放大"
            onClick={(e) => {
              e.stopPropagation();
              setScale((s) => Math.min(5, s + 0.25));
            }}
          >
            <ZoomIn className="size-5" />
          </button>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-sm text-fg hover:bg-elevated"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {items.length > 1 ? (
          <>
            <button
              type="button"
              className="absolute left-1 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg/70 text-fg hover:bg-bg"
              aria-label="上一张"
              onClick={(e) => {
                e.stopPropagation();
                onIndex((index - 1 + items.length) % items.length);
              }}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="absolute right-1 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg/70 text-fg hover:bg-bg"
              aria-label="下一张"
              onClick={(e) => {
                e.stopPropagation();
                onIndex((index + 1) % items.length);
              }}
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        ) : null}

        <div
          className="flex size-full items-center justify-center overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={(e) => {
            e.preventDefault();
            const next = e.deltaY > 0 ? scale * 0.9 : scale * 1.1;
            setScale(Math.min(5, Math.max(1, next)));
          }}
          onDoubleClick={() => {
            if (scale > 1) {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            } else setScale(2);
          }}
        >
          <div
            className={cn(
              "max-h-full max-w-full transition-[opacity,transform] duration-300 ease-out",
              visible ? "opacity-100" : "opacity-0",
            )}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${visible ? scale : Math.max(0.96, scale * 0.96)})`,
            }}
          >
            {item.ugoira ? (
              <UgoiraPlayer
                zipUrl={item.ugoira.zipUrl}
                frames={item.ugoira.frames}
                alt={item.alt}
                className="max-h-[80vh] max-w-[92vw]"
              />
            ) : (
              <img
                src={item.src}
                alt={item.alt}
                className="max-h-[80vh] max-w-[92vw] object-contain"
                draggable={false}
              />
            )}
          </div>
        </div>
      </div>
      {items.length > 1 ? (
        <div className="kami-lightbox-strip" onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) => (
            <button
              key={`${it.src}-${i}`}
              type="button"
              data-strip={i}
              aria-label={`第 ${i + 1} 页`}
              aria-current={i === index}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-md border transition-transform",
                i === index ? "border-accent ring-1 ring-accent" : "border-transparent opacity-70 hover:opacity-100",
              )}
              onClick={() => onIndex(i)}
            >
              {it.ugoira ? (
                <span className="flex size-full items-center justify-center bg-elevated text-[10px] text-muted">GIF</span>
              ) : (
                <img src={it.src} alt="" className="size-full object-cover" draggable={false} />
              )}
            </button>
          ))}
        </div>
      ) : null}
      {footer ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t border-border bg-bg/80 px-2 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          {footer}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
