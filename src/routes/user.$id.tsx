import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { FoldableText, ProfileAvatar } from "@/components/profile-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchSource, mutateSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { formatCount } from "@/lib/utils";
import { rememberAuthor } from "@/lib/view-history";
import { useEffect } from "react";
import { toast } from "sonner";
import { UserMinus, UserPlus } from "lucide-react";

export const Route = createFileRoute("/user/$id")({ component: UserPage });

function UserPage() {
  const { id } = Route.useParams();
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ["user", id, safeMode, hideAi, pixivCookie],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const r = await fetchSource({
        data: { op: "pixivUser", id, offset: pageParam, ...cookiesFromSettings() },
      });
      if (r.op !== "pixivUser") throw new Error("返回异常");
      return r;
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.listTotal ? next : undefined;
    },
  });

  useEffect(() => {
    const profile = query.data?.pages[0]?.profile;
    if (!query.isSuccess || !profile) return;
    rememberAuthor({
      source: "pixiv",
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
    });
  }, [id, query.isSuccess, query.data?.pages]);

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
      <div className="space-y-3 py-12">
        <Alert variant="danger">
          <AlertTitle>无法加载画师</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : "请检查链接，或在设置中填入登录 Cookie。"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const first = query.data.pages[0];
  const profile = first.profile;
  const pickup = first.pickup;
  const newestId = first.newestId;
  const total = first.total;
  const items = query.data.pages.flatMap((page, i) => (i === 0 ? page.items : page.items));
  const pinned = pickup;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4 md:gap-5">
        <ProfileAvatar src={profile.avatar} name={profile.name} />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="font-display text-2xl leading-tight tracking-tight md:text-3xl">{profile.name}</h1>
          <p className="text-xs tabular-nums text-muted">
            {formatCount(total)} 件作品
            {profile.following ? ` · 关注 ${formatCount(profile.following)}` : ""}
          </p>
          {profile.comment ? <FoldableText text={profile.comment} /> : null}
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
                  queryClient.setQueryData(["user", id, safeMode, hideAi, pixivCookie], (old: unknown) => {
                    if (!old || typeof old !== "object") return old;
                    const rec = old as { pages?: { profile: { isFollowed?: boolean } }[] };
                    if (!rec.pages) return old;
                    return {
                      ...rec,
                      pages: rec.pages.map((page) => ({
                        ...page,
                        profile: { ...page.profile, isFollowed: on },
                      })),
                    };
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
      {pinned.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted">置顶</h2>
          <ArtworkGrid
            items={pinned}
            marksOf={(work) => {
              const marks = ["置顶"];
              if (work.id === newestId) marks.unshift("最新");
              return marks;
            }}
          />
        </section>
      ) : null}
      <section className="space-y-3">
        {pinned.length > 0 ? <h2 className="text-sm font-medium text-muted">作品</h2> : null}
        <ArtworkGrid items={items} marksOf={(work) => (work.id === newestId ? ["最新"] : undefined)} />
        <InfiniteSentinel
          disabled={!query.hasNextPage || query.isFetchingNextPage}
          onVisible={() => void query.fetchNextPage()}
        />
      </section>
    </div>
  );
}
