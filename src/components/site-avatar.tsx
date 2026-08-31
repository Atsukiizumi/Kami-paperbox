import { UserRound } from "lucide-react";
import { ProxiedImg } from "@/components/proxied-img";
import { cn } from "@/lib/utils";
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
  const box = cn("shrink-0 overflow-hidden rounded-full bg-elevated", SIZE[size], className);
  if (profile?.avatar) {
    return <ProxiedImg src={profile.avatar} alt={profile.name || ""} className={box} />;
  }
  return (
    <span className={cn("inline-flex items-center justify-center text-muted", box)} aria-hidden>
      <UserRound className={size === "lg" ? "size-5" : "size-3.5"} />
    </span>
  );
}
