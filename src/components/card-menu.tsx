/**
 * 卡片右键菜单。
 *
 * 作用：鼠标右键打开、保存、红心、入队、复制链接，不必先点进详情。
 * 用法：卡片 onContextMenu 里 setPos；点空白或滚动关掉。
 * 为什么：浏览时右手一直在鼠标上，右键比悬停小按钮更稳。
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Archive, Copy, Download, ExternalLink, Heart, PanelTop } from "lucide-react";
import type { WorkCard } from "@/lib/types";
import { workOriginUrl } from "@/lib/sites";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type CardMenuPos = { x: number; y: number };

export function CardMenu({
  work,
  pos,
  inVault,
  liked,
  onClose,
  onSave,
  onLike,
  onQueue,
}: {
  work: WorkCard;
  pos: CardMenuPos | null;
  inVault?: boolean;
  liked?: boolean;
  onClose: () => void;
  onSave: () => void;
  onLike?: () => void;
  onQueue: () => void;
}) {
  useEffect(() => {
    if (!pos) return;
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos, onClose]);

  if (!pos || typeof document === "undefined") return null;
  const origin = workOriginUrl(work.source, work.id, work.authorId);
  const left = Math.min(pos.x, window.innerWidth - 220);
  const top = Math.min(pos.y, window.innerHeight - 280);

  return createPortal(
    <div
      role="menu"
      className="fixed z-[70] min-w-48 overflow-hidden rounded-xl border border-border bg-surface p-1.5 text-fg shadow-[var(--shadow-float)]"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Link
        role="menuitem"
        to="/work/$source/$id"
        params={{ source: work.source, id: work.id }}
        className={itemClass}
        onClick={onClose}
      >
        <PanelTop className="size-4" />
        打开
      </Link>
      <a
        role="menuitem"
        href={`/work/${work.source}/${work.id}`}
        target="_blank"
        rel="noreferrer"
        className={itemClass}
        onClick={onClose}
      >
        <ExternalLink className="size-4" />
        新标签打开
      </a>
      <button type="button" role="menuitem" className={itemClass} disabled={work.restricted} onClick={onSave}>
        <Archive className="size-4" />
        {inVault ? "已在纸匣" : "保存"}
      </button>
      {work.source === "pixiv" && onLike ? (
        <button type="button" role="menuitem" className={itemClass} onClick={onLike}>
          <Heart className={cn("size-4", liked && "fill-current text-danger")} />
          {liked ? "已红心" : "红心"}
        </button>
      ) : null}
      <button type="button" role="menuitem" className={itemClass} disabled={work.restricted} onClick={onQueue}>
        <Download className="size-4" />
        加入队列
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          void navigator.clipboard.writeText(origin).then(
            () => {
              toast.success("已复制链接");
              onClose();
            },
            () => onClose(),
          );
        }}
      >
        <Copy className="size-4" />
        复制原始链接
      </button>
    </div>,
    document.body,
  );
}

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-elevated disabled:pointer-events-none disabled:opacity-40";
