import { Archive, Download, ExternalLink, Heart, Star, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkDetail } from "@/lib/types";

export function WorkActions({
  work,
  saving,
  compact,
  originUrl,
  onSave,
  onDownload,
  onBookmark,
  onLike,
  onFollow,
}: {
  work: WorkDetail;
  saving?: boolean;
  compact?: boolean;
  originUrl?: string;
  onSave: () => void;
  onDownload: () => void;
  onBookmark?: () => void;
  onLike?: () => void;
  onFollow?: () => void;
}) {
  const sm = compact ? "sm" : "default";
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact && "justify-center")}>
      <Button size={sm} disabled={saving || work.restricted} onClick={onSave}>
        <Archive className="size-4" />
        保存
      </Button>
      <Button size={sm} variant="secondary" disabled={saving || work.restricted} onClick={onDownload}>
        <Download className="size-4" />
        下载
      </Button>
      {work.source === "pixiv" && onBookmark ? (
        <Button size={sm} variant={work.bookmarked ? "secondary" : "ghost"} onClick={onBookmark}>
          <Star className={cn("size-4", work.bookmarked && "fill-current")} />
          {work.bookmarked ? "已收藏" : "收藏"}
        </Button>
      ) : null}
      {(work.source === "pixiv" || work.source === "fanbox") && onLike ? (
        <Button size={sm} variant={work.liked ? "secondary" : "ghost"} onClick={onLike}>
          <Heart className={cn("size-4", work.liked && "fill-current text-danger")} />
          {work.liked ? "已红心" : "红心"}
        </Button>
      ) : null}
      {(work.source === "pixiv" || work.source === "fanbox") && onFollow ? (
        <Button size={sm} variant={work.followed ? "secondary" : "ghost"} onClick={onFollow}>
          {work.followed ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />}
          {work.followed ? "已关注" : "关注"}
        </Button>
      ) : null}
      {originUrl ? (
        <Button size={sm} variant="ghost" asChild>
          <a href={originUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            原始链接
          </a>
        </Button>
      ) : null}
    </div>
  );
}
