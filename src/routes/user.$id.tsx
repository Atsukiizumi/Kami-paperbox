import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSource, mutateSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { formatCount } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { UserMinus, UserPlus } from "lucide-react";

export const Route = createFileRoute("/user/$id")({ component: UserPage });

function UserPage() {
  const { id } = Route.useParams();
  const [offset, setOffset] = useState(0);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["user", id, offset, safeMode, hideAi, pixivCookie],
    queryFn: async () => {
      const r = await fetchSource({
        data: { op: "pixivUser", id, offset, ...cookiesFromSettings() },
      });
      if (r.op !== "pixivUser") throw new Error("返回异常");
      return r;
    },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <ArtworkGridSkeleton count={6} />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <p className="py-12 text-sm text-muted">
        {query.error instanceof Error ? query.error.message : "无法加载画师"}
      </p>
    );
  }

  const { profile, items, total } = query.data;

  return (
    <div className="space-y-6">
      <header className="flex gap-4">
        <div className="size-16 overflow-hidden rounded-full bg-elevated">
          <ProxiedImg src={profile.avatar} alt="" className="size-full" />
        </div>
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl">{profile.name}</h1>
          <p className="text-xs tabular-nums text-muted">
            {formatCount(total)} 件作品
            {profile.following ? ` · 关注 ${formatCount(profile.following)}` : ""}
          </p>
          {profile.comment ? (
            <p className="line-clamp-3 text-sm text-muted">{profile.comment}</p>
          ) : null}
          <Button
            size="sm"
            variant={profile.isFollowed ? "secondary" : "default"}
            className="mt-2"
            onClick={() => {
              if (!pixivCookie) {
                toast.error("先在设置里添加 Pixiv 账号");
                return;
              }
              const on = !profile.isFollowed;
              void mutateSource({
                data: { op: "pixivFollow", userId: profile.id, on, ...cookiesFromSettings() },
              })
                .then(() => {
                  queryClient.setQueryData(["user", id, offset, safeMode, hideAi, pixivCookie], (old: unknown) => {
                    if (!old || typeof old !== "object") return old;
                    const rec = old as { profile: { isFollowed?: boolean } };
                    return { ...rec, profile: { ...rec.profile, isFollowed: on } };
                  });
                  toast.success(on ? `已关注 ${profile.name}` : "已取消关注");
                })
                .catch((err: unknown) => {
                  toast.error(err instanceof Error ? err.message : "关注失败");
                });
            }}
          >
            {profile.isFollowed ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />}
            {profile.isFollowed ? "已关注" : "关注"}
          </Button>
        </div>
      </header>
      <ArtworkGrid items={items} />
      <div className="flex justify-center gap-2">
        <Button
          variant="secondary"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - 60))}
        >
          上一批
        </Button>
        <Button
          variant="secondary"
          disabled={offset + 60 >= total}
          onClick={() => setOffset((o) => o + 60)}
        >
          下一批
        </Button>
      </div>
    </div>
  );
}
