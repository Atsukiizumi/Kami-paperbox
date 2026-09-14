"use client";

/**
 * 卡片操作托（悬停在封面上浮出的那排圆钮）。
 *
 * 作用：纸匣形态是导出/移除，浏览形态是收纸匣/入队/红心；CardIconButton 是托内
 *      的圆钮样式。
 * 用法：ArtworkCard 尾部渲染；交互回调（saveCard/queueCard/likeCard/hidePreview）
 *      由 use-card-interactions 提供后传入，这里不放逻辑。
 * 为什么：托的显隐靠祖先 .group 的 hover 类（group-hover:），抽成子组件不影响
 *        DOM 位置，卡片本体少一整段按钮接线。
 */
import type { MouseEvent, ReactNode } from "react";
import { Archive, Check, Download, Heart, ListOrdered, Trash2 } from "lucide-react";
import type { WorkCard } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CardActionTray({
  work,
  variant,
  inVault,
  inQueue,
  liked,
  liking,
  heartPop,
  onExport,
  onDelete,
  saveCard,
  queueCard,
  likeCard,
  hidePreview,
}: {
  work: WorkCard;
  variant: "browse" | "vault";
  inVault: boolean;
  inQueue: boolean;
  liked: boolean;
  liking: boolean;
  heartPop: boolean;
  onExport?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
  saveCard: (e?: MouseEvent) => Promise<void>;
  queueCard: (e?: MouseEvent) => void;
  likeCard: (e?: MouseEvent) => Promise<void>;
  hidePreview: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end p-2 opacity-100 transition-[opacity,transform] duration-200 ease-out md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
      <div className="kami-action-tray">
        {variant === "vault" ? (
          <>
            {onExport ? (
              <CardIconButton label="导出" onClick={onExport} onHover={hidePreview}>
                <Download className="size-4" />
              </CardIconButton>
            ) : null}
            {onDelete ? (
              <CardIconButton label="从纸匣移除" onClick={onDelete} onHover={hidePreview}>
                <Trash2 className="size-4" />
              </CardIconButton>
            ) : null}
          </>
        ) : (
          <>
            <CardIconButton
              label={inVault ? "已在纸匣" : "收入纸匣"}
              disabled={work.restricted}
              active={inVault}
              onClick={(e) => void saveCard(e)}
              onHover={hidePreview}
            >
              {inVault ? (
                <Check className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </CardIconButton>
            <CardIconButton
              label={inQueue ? "已在队列" : "加入队列"}
              disabled={work.restricted}
              active={inQueue}
              onClick={(e) => queueCard(e)}
              onHover={hidePreview}
            >
              <ListOrdered className="size-4" />
            </CardIconButton>
            {work.source === "pixiv" ? (
              <CardIconButton
                label={liked ? "已红心" : "红心"}
                disabled={liking}
                active={liked}
                onClick={(e) => void likeCard(e)}
                onHover={hidePreview}
              >
                <Heart className={cn("size-4", liked && "fill-current text-danger", heartPop && "kami-pop-heart")} />
              </CardIconButton>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function CardIconButton({
  label,
  children,
  onClick,
  onHover,
  disabled,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onHover?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "pointer-events-auto flex size-8 items-center justify-center rounded-full text-fg",
        "transition-[transform,background-color,color] duration-150",
        "hover:bg-elevated active:scale-[0.96] disabled:opacity-50",
        active && "text-accent",
      )}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      {children}
    </button>
  );
}
