/**
 * 卡片悬停放大预览。
 *
 * 作用：封面从格子里长出来，用更大一档的图。
 * 用法：open + 卡片 getBoundingClientRect；源卡片自己把封面 opacity 隐掉。
 * 为什么：以前浮到旁边等于两张一样的图叠在网格上。从中心放大，才是同一张在变大。
 *        展开 250ms / 收回 150ms（动效批 Task 3，token 直读）；高清未就绪先
 *        用已显示的缩略图垫底，不出现空白放大框；中断从当前视觉续播，卸载收干净。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animateFlip } from "@/lib/motion";
import { cancelOwnedAnimations, readMotionTiming } from "@/lib/motion-runtime";
import { upgradeThumbUrl } from "@/lib/thumb-url";
import { cn } from "@/lib/utils";
import { ProxiedImg } from "./proxied-img";
import { UgoiraPlayer, useUgoiraMeta } from "./ugoira-player";

function place(anchor: DOMRect, aspect: number) {
  const maxW = Math.min(window.innerWidth - 32, 560);
  const width = Math.min(maxW, Math.max(anchor.width * 1.32, Math.min(anchor.width + 80, maxW)));
  const height = Math.min(window.innerHeight - 32, Math.round(width / Math.max(aspect, 0.4)));
  let left = anchor.left + (anchor.width - width) / 2;
  let top = anchor.top + (anchor.height - height) / 2;
  left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - height - 16));
  return { left, top, width, height };
}

export function HoverPreview({
  open,
  src,
  alt,
  aspect,
  anchor,
  ugoiraId,
  veiled = false,
}: {
  open: boolean;
  src?: string;
  alt: string;
  aspect: number;
  anchor: DOMRect | null;
  ugoiraId?: string;
  /** 访客遮盖开着时，放大图也模糊，不把封面放清晰。 */
  veiled?: boolean;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const held = useRef<{ src: string; alt: string; aspect: number; from: DOMRect } | null>(null);
  const [shown, setShown] = useState(false);
  const ugoira = useUgoiraMeta(ugoiraId, open);

  if (open && src && anchor) {
    held.current = { src, alt, aspect, from: anchor };
  }
  const shot = held.current;

  useLayoutEffect(() => {
    const shell = outer.current;
    const pack = held.current;
    if (!shell || !pack) return;

    let live = true;
    const to = place(pack.from, pack.aspect);
    const openMs = readMotionTiming(shell, "fast").duration;
    const closeMs = readMotionTiming(shell, "quick").duration;

    if (open) {
      setShown(true);
      animateFlip(shell, pack.from, to, { duration: openMs, opacityFrom: 1 });
      return () => {
        live = false;
      };
    }

    const back = animateFlip(shell, pack.from, to, {
      duration: closeMs,
      reverse: true,
      opacityFrom: 0,
      opacityTo: 1,
    });
    void back.finished.then((end) => {
      // 旧收尾不生效：这轮 effect 已被新的 open/close 顶替（live=false），或动画
      // 被改向取消（cancelled，后继自己管理状态）。finished / disabled（关停直落）
      // 才把预览真正藏掉——否则关掉动画后浮层会一直挂着。
      if (live && end !== "cancelled") setShown(false);
    });
    return () => {
      live = false;
      cancelOwnedAnimations(shell);
    };
  }, [open, src]);

  // 卸载时把壳上还挂着的重排/缩放动画收掉，不留残余补间
  useLayoutEffect(() => () => {
    const shell = outer.current;
    if (shell) cancelOwnedAnimations(shell);
  }, []);

  if (!shown && !open) return null;
  if (!shot || typeof document === "undefined") return null;
  const to = place(shot.from, shot.aspect);
  const hd = upgradeThumbUrl(shot.src);

  return createPortal(
    <>
      <div
        className="kami-xfade pointer-events-none fixed inset-0 z-[54]"
        style={{
          opacity: open ? 1 : 0,
          background:
            "radial-gradient(ellipse at center, transparent 42%, color-mix(in oklab, var(--color-bg) 55%, transparent) 100%)",
        }}
      />
      <div
        ref={outer}
        className="pointer-events-none fixed z-[55] overflow-hidden rounded-xl bg-bg shadow-[var(--shadow-float)]"
        style={{
          left: to.left,
          top: to.top,
          width: to.width,
          height: to.height,
          transformOrigin: "0 0",
        }}
      >
        <div className={cn("absolute inset-0", veiled && "blur-md select-none")}>
          {ugoira.data ? (
            <UgoiraPlayer
              zipUrl={ugoira.data.src}
              frames={ugoira.data.frames}
              alt={shot.alt}
              compact
              active={open}
              className="absolute inset-0 size-full"
            />
          ) : (
            <ProxiedImg
              src={hd}
              alt={shot.alt}
              fit="cover"
              priority
              fallbackSrc={shot.src}
              className="absolute inset-0 size-full"
            />
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

export function canHoverPreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
