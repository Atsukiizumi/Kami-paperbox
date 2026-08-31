/**
 * 站点头像。
 *
 * 作用：把 Pixiv / FANBOX 资料图放进圆形框，失败显示人像图标。
 * 用法：<SiteAvatar profile={siteProfile(account, "pixiv")} size="sm" />
 * 为什么：走 Radix Avatar，加载失败有 fallback；图片仍经 media 代理。
 */
import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, mediaUrl } from "@/lib/utils";
import type { SiteProfile } from "@/lib/site-identity";

const SIZE = {
  sm: "size-6",
  md: "size-8",
  lg: "size-12",
} as const;

export function SiteAvatar({
  profile,
  size = "sm",
  className,
}: {
  profile?: SiteProfile | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <Avatar className={cn(SIZE[size], className)}>
      {profile?.avatar ? (
        <AvatarImage src={mediaUrl(profile.avatar)} alt={profile.name || ""} />
      ) : null}
      <AvatarFallback>
        <UserRound className={size === "lg" ? "size-5" : "size-3.5"} />
      </AvatarFallback>
    </Avatar>
  );
}
