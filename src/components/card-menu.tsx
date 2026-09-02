/**
 * 卡片右键纸签。
 *
 * 作用：打开、入队、到原站。三项够用，不必先点进详情。
 * 用法：卡片 onContextMenu 里 setPos。
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Download, ExternalLink, PanelTop } from "lucide-react";
import type { WorkCard } from "@/lib/types";
import { workOriginUrl } from "@/lib/sites";

export type CardMenuPos = { x: number; y: number };

export function CardMenu({
  work,
  pos,
  onClose,
  onQueue,
}: {
  work: WorkCard;
  pos: CardMenuPos | null;
  inVault?: boolean;
  liked?: boolean;
  onClose: () => void;
  onSave?: () => void;
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
  const left = Math.min(pos.x + 8, window.innerWidth - 188);
  const top = Math.min(pos.y + 8, window.innerHeight - 160);

  return createPortal(
    <div
      role="menu"
      className="kami-ticket fixed z-[70] text-fg"
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
        <PanelTop className="size-3.5" />
        打开
      </Link>
      <button type="button" role="menuitem" className={itemClass} disabled={work.restricted} onClick={onQueue}>
        <Download className="size-3.5" />
        入队
      </button>
      <a role="menuitem" href={origin} target="_blank" rel="noreferrer" className={itemClass} onClick={onClose}>
        <ExternalLink className="size-3.5" />
        原站
      </a>
    </div>,
    document.body,
  );
}

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-none transition-colors hover:bg-elevated disabled:pointer-events-none disabled:opacity-40";
