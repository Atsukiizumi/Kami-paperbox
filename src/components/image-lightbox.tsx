import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UgoiraFrame } from "@/lib/ugoira-meta";
import { cn } from "@/lib/utils";
import { UgoiraPlayer } from "./ugoira-player";
import { warmMedia } from "./proxied-img";
import {
  canAnimateUi,
  cancelOwnedAnimations,
  commitOwnedMotion,
  playOwnedMotion,
  readMotionTiming,
} from "@/lib/motion-runtime";

export type LightboxItem = {
  /** 主图：优先原图——灯箱就是用来看细节的（媒体代理带 Referer，原图可达）。 */
  src: string;
  /** 底部缩略图条专用：中档图就够，别为 14 个小格子拉原图。缺省回退 src。 */
  thumb?: string;
  alt: string;
  caption?: string;
  ugoira?: { zipUrl: string; frames: UgoiraFrame[] };
};

/**
 * 灯箱主图：按 src 重挂（换页立即清掉旧位图，不再「停留在上一张」），
 * 加载中转圈、失败给文案，onLoad 后 150ms 淡入——下载过程可感知。
 */
function LightboxImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  return (
    // 尺寸链走 stage 实际可用区（size-full 逐层 definite）：92vh 硬编码不扣
    // 工具条/缩略条高度，多 P 作品图会伸进缩略条区被 overflow-hidden 裁掉。
    <div className="relative flex size-full items-center justify-center">
      {state !== "loaded" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {state === "loading" ? (
            <Loader2 className="size-8 animate-spin text-muted" aria-label="加载中" />
          ) : (
            <p className="text-sm text-muted">图片加载失败</p>
          )}
        </div>
      ) : null}
      <img
        src={src}
        alt={alt}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        className={cn(
          "kami-img-reveal max-h-full max-w-full object-contain",
          state === "loaded" ? "opacity-100" : "opacity-0",
        )}
        draggable={false}
      />
    </div>
  );
}

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
  const [shown, setShown] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** 手势进行中：内层 transform 不做时间补间（拖拽/捏合直接跟手）。 */
  const [gestureLive, setGestureLive] = useState(false);
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
  /** 内层舞台（图像区）：缩放/捏合的锚点矩形来源。 */
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** 外层对话框：开合动画的宿主。 */
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const view = useRef({ scale, offset });
  view.current = { scale, offset };
  // 退出代际闸：退出动画完成后只有最新一代有权卸载——中途重开不会被旧收尾关掉
  const exitGen = useRef(0);
  /** 本次挂载是否还没播过首轮进场（挂载后的首轮 effect 从隐藏态展开）。 */
  const firstEnter = useRef(false);

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

  // ── 开合生命周期（动效批 Task 5）────────────────────────────────────
  // 外层进出走运行时托管：进场 fast 250ms、收起 quick 150ms；关停/无 WAAPI
  // 时同步落终态（open=true 保持可见，open=false 才卸载）；退出以 generation
  // 闸识别，旧收尾永远关不掉新灯箱。没有 rAF / 固定卸载定时器——后台标签页
  // 也不会冻结在透明层。首轮挂载从隐藏态展开；中途重开从当前视觉续播；
  // 退出前先截当前视觉——进场未完就关，不先跳回 1 再淡出。
  useLayoutEffect(() => {
    const stage = dialogRef.current;
    if (open) {
      exitGen.current += 1;
      if (!shown) {
        firstEnter.current = true; // 挂载后的下一轮 effect 播首轮进场
        setShown(true);
        return;
      }
      const initial = firstEnter.current;
      firstEnter.current = false;
      if (!stage || !canAnimateUi(stage)) return;
      const { duration, easing } = readMotionTiming(stage, "fast");
      const from = initial
        ? { opacity: "0", transform: "scale(0.97)" }
        : ((now) => ({ opacity: String(now.opacity), transform: now.transform }))(commitOwnedMotion(stage));
      playOwnedMotion(
        stage,
        [from, { opacity: "1", transform: "scale(1)" }],
        { duration, easing, fill: "both" },
      );
      return;
    }
    if (!shown) return;
    const gen = ++exitGen.current;
    if (!stage || !canAnimateUi(stage)) {
      setShown(false); // 关停：同步卸载，不留透明拦截层
      return;
    }
    const now = commitOwnedMotion(stage);
    const { duration, easing } = readMotionTiming(stage, "quick");
    const exit = playOwnedMotion(
      stage,
      [
        { opacity: String(now.opacity), transform: now.transform },
        { opacity: "0", transform: "scale(0.985)" },
      ],
      { duration, easing, fill: "both" },
    );
    void exit.finished.then((end) => {
      if (exitGen.current !== gen || end === "cancelled") return;
      setShown(false);
    });
  }, [open, shown]);

  // 卸载时收掉外层在播动画（登记项不滞留）——cleanup 里现读 ref，
  // 常态以 open=false 挂载时捕获到的会是 null。
  useEffect(() => {
    return () => {
      const dialog = dialogRef.current;
      if (dialog) cancelOwnedAnimations(dialog);
    };
  }, []);

  // 打开前焦点：关闭后还给仍然挂载的触发元素
  useEffect(() => {
    if (!shown) return;
    const prevFocus = document.activeElement;
    return () => {
      if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus();
    };
  }, [shown]);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setGestureLive(false);
    pointers.current.clear();
    pinch.current = null;
    drag.current = null;
  }, [index, open]);

  useEffect(() => {
    if (!shown || items.length < 2) return;
    const el = document.querySelector<HTMLElement>(`[data-strip="${index}"]`);
    const strip = el?.closest<HTMLElement>(".kami-lightbox-strip");
    if (!el || !strip) return;
    // 只滚缩略条自身：scrollIntoView 会沿祖先链滚到 window（body 锁滚也能
    // 程序滚动），灯箱开着时页面在背后被拽动。动效关闭时直接落位不平滑。
    const left = el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2;
    if (canAnimateUi()) strip.scrollTo({ left, behavior: "smooth" });
    else strip.scrollLeft = left;
  }, [index, shown, items.length]);

  // 相邻页预热：前后各两页走 warmMedia（媒体车道限流 + warmThumbs 去重 + 低优先级），
  // 换页时图已在缓存——多 p 翻页即点即现。ugoira 的 zip 重，播放器自己管。
  useEffect(() => {
    if (!shown || items.length < 2) return;
    const n = items.length;
    for (const d of [1, -1, 2, -2]) {
      const it = items[(index + d + n * 2) % n];
      if (it && !it.ugoira) warmMedia(it.src);
    }
  }, [shown, index, items]);

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
    // 指针捕获让移出窗口也能收到 up/cancel；环境里没有活动指针时（老浏览器/
    // 测试垫片）会抛 NotFoundError——捕获是优化不是前提，吞掉继续手势。
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 无活动指针可捕获 */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setGestureLive(true);
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
      // 捏合回落到单指：以剩余指为新的拖拽基准（继续跟手，不跳变）
      const [rest] = [...pointers.current.values()];
      drag.current = { x: rest.x, y: rest.y, ox: offset.x, oy: offset.y, moved: true };
      return;
    }
    if (pointers.current.size === 0) setGestureLive(false);
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
      ref={dialogRef}
      className="kami-lightbox-stage fixed inset-0 z-50 flex flex-col"
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
          {/* 内层变换：手势进行中零补间（直接跟手）；离散操作（按钮/双击/键盘）
              才走 150ms 短过渡。 */}
          <div
            className={cn("size-full", gestureLive ? undefined : "kami-zoom-smooth")}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          >
            {item.ugoira ? (
              <UgoiraPlayer
                zipUrl={item.ugoira.zipUrl}
                frames={item.ugoira.frames}
                alt={item.alt}
                className="max-h-full max-w-full"
              />
            ) : (
              <LightboxImage key={item.src} src={item.src} alt={item.alt} />
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
