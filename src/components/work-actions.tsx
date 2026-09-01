/**
 * 作品页操作条。
 *
 * 作用：纸匣、下载、队列、红心等收在一条纸质条里，跟浏览卡片那条胶囊同一套气质。
 * 用法：详情页和灯箱 footer；compact 给灯箱，不放队列和搜来源。
 * 为什么：一排独立 shadcn 按钮像后台，不像纸匣。
 */
import { Archive, Download, ExternalLink, Heart, ListOrdered, ScanSearch, Star, UserMinus, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkDetail } from "@/lib/types";
import type { ReactNode } from "react";

export function WorkActions({
  work,
  saving,
  compact,
  originUrl,
  onSave,
  onDownload,
  onQueue,
  onSearchOrigin,
  onBookmark,
  onLike,
  onFollow,
  inVault,
  inQueue,
}: {
  work: WorkDetail;
  saving?: boolean;
  compact?: boolean;
  originUrl?: string;
  onSave: () => void;
  onDownload: () => void;
  onQueue?: () => void;
  onSearchOrigin?: () => void;
  onBookmark?: () => void;
  onLike?: () => void;
  onFollow?: () => void;
  inVault?: boolean;
  inQueue?: boolean;
}) {
  const blocked = Boolean(saving || work.restricted);
  return (
    <div className={cn("kami-work-actions", compact && "kami-work-actions-compact")}>
      <ActionChip
        label={inVault ? "已在纸匣" : "收入纸匣"}
        primary={!inVault}
        active={inVault}
        disabled={blocked}
        onClick={onSave}
      >
        <Archive className="size-4" />
        {inVault ? "已在纸匣" : "纸匣"}
      </ActionChip>
      <ActionChip label="下载到本机" disabled={blocked} onClick={onDownload}>
        <Download className="size-4" />
        下载
      </ActionChip>
      {!compact && onQueue ? (
        <ActionChip
          label={inQueue ? "已在队列" : "加入队列"}
          active={inQueue}
          disabled={blocked}
          onClick={onQueue}
        >
          <ListOrdered className="size-4" />
          {inQueue ? "已在队列" : "队列"}
        </ActionChip>
      ) : null}
      {work.source === "pixiv" && onBookmark ? (
        <ActionChip
          label={work.bookmarked ? "已收藏" : "收藏"}
          active={work.bookmarked}
          onClick={onBookmark}
        >
          <Star className={cn("size-4", work.bookmarked && "fill-current")} />
          {work.bookmarked ? "已收藏" : "收藏"}
        </ActionChip>
      ) : null}
      {(work.source === "pixiv" || work.source === "fanbox") && onLike ? (
        <ActionChip label={work.liked ? "已红心" : "红心"} active={work.liked} danger={work.liked} onClick={onLike}>
          <Heart className={cn("size-4", work.liked && "fill-current")} />
          {work.liked ? "已红心" : "红心"}
        </ActionChip>
      ) : null}
      {(work.source === "pixiv" || work.source === "fanbox") && onFollow ? (
        <ActionChip
          label={work.followed ? "已关注" : "关注"}
          active={work.followed}
          onClick={onFollow}
        >
          {work.followed ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />}
          {work.followed ? "已关注" : "关注"}
        </ActionChip>
      ) : null}
      {!compact && onSearchOrigin ? (
        <ActionChip label="用这张图搜来源" disabled={work.restricted} onClick={onSearchOrigin}>
          <ScanSearch className="size-4" />
          搜来源
        </ActionChip>
      ) : null}
      {originUrl ? (
        <a
          href={originUrl}
          target="_blank"
          rel="noreferrer"
          title="原始链接"
          className="kami-work-action"
        >
          <ExternalLink className="size-4" />
          原站
        </a>
      ) : null}
    </div>
  );
}

function ActionChip({
  label,
  children,
  onClick,
  disabled,
  primary,
  active,
  danger,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "kami-work-action",
        primary && "kami-work-action-primary",
        active && !primary && "kami-work-action-on",
        danger && "kami-work-action-heart",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
