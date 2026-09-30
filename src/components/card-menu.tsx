"use client";

/**
 * 卡片右键纸签。
 *
 * 作用：打开、新标签页打开、入队、到原站、复制图片（canCopyImage，有图即可；
 *      执行链在 copy-image，纸匣态直取/浏览态合成）；可选「加入合集」（纸匣
 *      variant）与「添加翻译」（quickTag，题注未翻 tag 右键快译）。不必先点进详情。
 * 用法：卡片 onContextMenu 里 setPos；inVault 由 ArtworkCard 传入（复制直取纸匣）。
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Link, useNavigate } from "@/lib/kami-link";
import {
  ClipboardCopy,
  Download,
  ExternalLink,
  Languages,
  ListPlus,
  PanelTop,
  ScanSearch,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { WorkCard } from "@/lib/types";
import { isBooru, workOriginUrl } from "@/lib/sites";
import { stashImageForSearch } from "@/lib/find-similar";
import { useTagLexicon } from "@/lib/tag-lexicon";
import { canCopyImage, copyWorkImage } from "@/lib/copy-image";

export type CardMenuPos = { x: number; y: number };

export function CardMenu({
  work,
  pos,
  inVault,
  onClose,
  onQueue,
  onAddToCollection,
  quickTag,
}: {
  work: WorkCard;
  pos: CardMenuPos | null;
  /** 已在纸匣（ArtworkCard 传入）：复制 GIF 走 getVaultBlob 直取，不重新合成。 */
  inVault?: boolean;
  liked?: boolean;
  onClose: () => void;
  onSave?: () => void;
  onLike?: () => void;
  onQueue: () => void;
  /** 加入合集（纸匣 variant 由调用方传入）：不传不渲染菜单项，浏览侧零影响。 */
  onAddToCollection?: () => void;
  /** 未翻 booru tag（题注右键经 ArtworkCard 传入）：有值才出「添加翻译」项。 */
  quickTag?: string;
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
  const navigate = useNavigate();

  if (!pos || typeof document === "undefined") return null;
  const origin = workOriginUrl(work.source, work.id, work.authorId);
  // 找相似的（M2-3）：仅 booru/pixiv 且有封面图才出——fanbox 无预览、无图卡（hasFile=false
  // 的文件夹副本 thumb 为空串）天然排除；组件内自渲染，浏览卡/纸匣卡一处生效两处
  const canFindSimilar = (isBooru(work.source) || work.source === "pixiv") && Boolean(work.thumb);
  // 复制图片（决策 1 放宽）：有图即可出项——GIF 保动画、静态图按 blob MIME 写；
  // 执行链 copyWorkImage 里做纸匣直取/合成与降级下载
  const canCopy = canCopyImage(work);
  const left = Math.min(pos.x + 8, window.innerWidth - 188);
  // 菜单高度随项数变：新标签页打开恒有一行，复制 GIF / 加入合集 / 添加翻译 /
  // 找相似的每多一项多留一行，避免贴底被裁
  const top = Math.min(
    pos.y + 8,
    window.innerHeight -
      (onAddToCollection ? 232 : 196) -
      (quickTag ? 36 : 0) -
      (canFindSimilar ? 36 : 0) -
      (canCopy ? 36 : 0),
  );

  return createPortal(
    <div
      role="menu"
      className="kami-ticket fixed z-[70] text-fg"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {quickTag ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onClose();
            // prompt 取消 / 空串都忽略，不得走 setZh（空 zh 在 upsertLexiconRow 是删译文语义）
            const zh = window.prompt(`为「${quickTag}」添加中文翻译`, "");
            if (!zh || !zh.trim()) return;
            useTagLexicon.getState().setZh(quickTag, zh.trim());
          }}
        >
          <Languages className="size-3.5" />
          添加翻译
        </button>
      ) : null}
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
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onClose();
          // R6：SPA 跳转没有系统级新标签页语义，window.open 带 noopener 断开 opener
          window.open(`/work/${work.source}/${work.id}`, "_blank", "noopener,noreferrer");
        }}
      >
        <SquareArrowOutUpRight className="size-3.5" />
        在新标签页打开
      </button>
      <button type="button" role="menuitem" className={itemClass} disabled={work.restricted} onClick={onQueue}>
        <Download className="size-3.5" />
        入队
      </button>
      <a role="menuitem" href={origin} target="_blank" rel="noreferrer" className={itemClass} onClick={onClose}>
        <ExternalLink className="size-3.5" />
        原站
      </a>
      {onAddToCollection ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onClose();
            onAddToCollection();
          }}
        >
          <ListPlus className="size-3.5" />
          加入合集
        </button>
      ) : null}
      {canCopy ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onClose();
            // 取像素/合成/降级下载都在 copyWorkImage：纸匣态直取、浏览态临时合成（R4 不落库）
            void copyWorkImage(work, { inVault });
          }}
        >
          <ClipboardCopy className="size-3.5" />
          复制 GIF
        </button>
      ) : null}
      {canFindSimilar ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onClose();
            // stash 成功才跳：失败已 toast，跳过去也只是空搜图页
            void stashImageForSearch(work.thumb, `${work.id}.jpg`).then((ok) => {
              if (ok) navigate({ to: "/search" });
            });
          }}
        >
          <ScanSearch className="size-3.5" />
          找相似的
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-none transition-colors hover:bg-elevated disabled:pointer-events-none disabled:opacity-40";
