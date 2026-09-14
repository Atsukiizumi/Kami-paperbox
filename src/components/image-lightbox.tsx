import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UgoiraFrame } from "@/lib/ugoira-meta";
import { cn } from "@/lib/utils";
import { UgoiraPlayer } from "./ugoira-player";

export type LightboxItem = {
  /** 主图：优先原图——灯箱就是用来看细节的（媒体代理带 Referer，原图可达）。 */
  src: string;
  /** 底部缩略图条专用：中档图就够，别为 14 个小格子拉原图。缺省回退 src。 */
  thumb?: string;
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
  // 双指捏合（纸感质感批 PR3b）：两指在屏即进入手势，基准距离/中点/变换，
  // 移动时按比例缩放并跟随中点平移；单指回落到拖拽。
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    baseScale: number;
    baseOffset: { x: number; y: number };
    baseDist: number;
    baseMid: { x: number; y: number };
  } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const view = useRef({ scale, offset });
  view.current = { scale, offset };

  /** 以屏幕坐标 (sx,sy) 为锚点缩放到 next：光标/双指中点下的内容点保持不动。 */
  function zoomAt(sx: number, sy: number, next: number) {
    const clamped = Math.min(5, Math.max(1, next));
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      setScale(clamped);
      if (clamped === 1) setOffset({ x: 0, y: 0 });
      return;
    }
    const cx = sx - (rect.left + rect.width / 2);
    const cy = sy - (rect.top + rect.height / 2);
    const { scale: s, offset: o } = view.current;
    const k = clamped / s;
    setOffset({
      x: cx - k * (cx - o.x),
      y: cy - k * (cy - o.y),
    });
    setScale(clamped);
    if (clamped === 1) setOffset({ x: 0, y: 0 });
  }

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
    pointers.current.clear();
    pinch.current = null;
    drag.current = null;
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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        baseScale: view.current.scale,
        baseOffset: view.current.offset,
        baseDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        baseMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      drag.current = null;
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const base = pinch.current;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = Math.min(5, Math.max(1, base.baseScale * (dist / base.baseDist)));
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = mid.x - (rect.left + rect.width / 2);
        const cy = mid.y - (rect.top + rect.height / 2);
        const bx = base.baseMid.x - (rect.left + rect.width / 2);
        const by = base.baseMid.y - (rect.top + rect.height / 2);
        // 基准中点下的内容点在新变换后跟随当前中点（缩放 + 双指平移一体）。
        const px = (bx - base.baseOffset.x) / base.baseScale;
        const py = (by - base.baseOffset.y) / base.baseScale;
        setOffset({ x: cx - next * px, y: cy - next * py });
        setScale(next);
        if (next === 1) setOffset({ x: 0, y: 0 });
      }
      return;
    }
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
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      drag.current = { x: rest.x, y: rest.y, ox: offset.x, oy: offset.y, moved: true };
      return;
    }
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
        "kami-lightbox-stage fixed inset-0 z-50 flex flex-col transition-opacity duration-300 ease-out",
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
          ref={stageRef}
          className="flex size-full items-center justify-center overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => {
            e.preventDefault();
            zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? view.current.scale * 0.9 : view.current.scale * 1.1);
          }}
          onDoubleClick={(e) => {
            if (scale > 1) {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            } else zoomAt(e.clientX, e.clientY, 2);
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
                className="max-h-[92vh] max-w-[94vw] object-contain"
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
                <img src={it.thumb || it.src} alt="" className="size-full object-cover" draggable={false} />
              )}
            </button>
          ))}
        </div>
      ) : null}
      {footer ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-center gap-1 bg-bg/55 px-2 py-1.5 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          {footer}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
