import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtworkGrid } from "@/components/artwork-card";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import type { FanboxCursor, WorkCard } from "@/lib/types";

export const Route = createFileRoute("/creator/$id")({ component: CreatorPage });

function CreatorPage() {
  const { id } = Route.useParams();
  const fanboxCookie = useSettings((s) => s.fanboxCookie);
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

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <p className="py-12 text-sm text-muted">
        {query.error instanceof Error ? query.error.message : "无法加载创作者"}
      </p>
    );
  }

  const profile = query.data.pages[0]?.profile;
  const items: WorkCard[] = query.data.pages.flatMap((p) => p.items);

  return (
    <div className="space-y-6">
      {profile?.cover ? (
        <div className="overflow-hidden rounded-lg">
          <ProxiedImg src={profile.cover} alt="" className="h-36 w-full object-cover md:h-48" />
        </div>
      ) : null}
      <header className="flex gap-4">
        <div className="size-16 overflow-hidden rounded-full bg-elevated">
          <ProxiedImg src={profile?.avatar} alt="" className="size-full" />
        </div>
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl">{profile?.name ?? id}</h1>
          <p className="text-xs text-muted">@{profile?.id ?? id}</p>
          {profile?.description ? (
            <p className="line-clamp-4 text-sm text-muted">{profile.description}</p>
          ) : null}
        </div>
      </header>
      <ArtworkGrid items={items} />
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "加载中…" : "更多投稿"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
