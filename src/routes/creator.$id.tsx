import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { FoldableText, ProfileAvatar } from "@/components/profile-header";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { ProxiedImg } from "@/components/proxied-img";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { fanboxSessionFrom } from "@/lib/browser-login";
import { rememberAuthor } from "@/lib/view-history";
import type { FanboxCursor, WorkCard } from "@/lib/types";
import { useEffect } from "react";

export const Route = createFileRoute("/creator/$id")({ component: CreatorPage });

function CreatorPage() {
  const { id } = Route.useParams();
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const safeMode = useSettings((s) => s.safeMode);

  const query = useInfiniteQuery({
    queryKey: ["creator", id, safeMode, fanboxCookie],
    initialPageParam: undefined as FanboxCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await fetchSource({
        data: {
          op: "fanboxCreator",
          id,
          cursor: pageParam,
          ...cookiesFromSettings(),
        },
      });
      if (r.op !== "fanboxCreator") throw new Error("返回异常");
      return r;
    },
    getNextPageParam: (last) => last.cursor ?? undefined,
  });

  useEffect(() => {
    const profile = query.data?.pages[0]?.profile;
    if (!query.isSuccess || !profile) return;
    rememberAuthor({
      source: "fanbox",
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
    });
  }, [id, query.isSuccess, query.data?.pages]);

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <ArtworkGridSkeleton count={6} />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="space-y-3 py-12">
        <Alert variant="danger">
          <AlertTitle>无法加载创作者</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : "请检查链接，或在设置中填入登录 Cookie。"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const profile = query.data.pages[0]?.profile;
  const items: WorkCard[] = query.data.pages.flatMap((p) => p.items);

  return (
    <div className="space-y-6">
      {profile?.cover ? (
        <div className="overflow-hidden rounded-xl">
          <ProxiedImg src={profile.cover} alt="" className="h-36 w-full object-cover md:h-48" />
        </div>
      ) : null}
      <header className="flex items-start gap-4 md:gap-5">
        <ProfileAvatar src={profile?.avatar} name={profile?.name ?? id} />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="font-display text-2xl leading-tight tracking-tight md:text-3xl">
            {profile?.name ?? id}
          </h1>
          <p className="text-xs text-muted">@{profile?.id ?? id}</p>
          {profile?.description ? <FoldableText text={profile.description} lines={4} /> : null}
        </div>
      </header>
      <ArtworkGrid items={items} />
      <InfiniteSentinel
        disabled={!query.hasNextPage || query.isFetchingNextPage}
        onVisible={() => void query.fetchNextPage()}
      />
    </div>
  );
}
