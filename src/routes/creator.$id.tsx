import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { BackToBrowse } from "@/components/back-to-browse";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { fanboxSessionFrom } from "@/lib/browser-login";
import type { FanboxCursor, WorkCard } from "@/lib/types";

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

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <BackToBrowse />
        <Skeleton className="h-28 w-full rounded-lg" />
        <ArtworkGridSkeleton count={6} />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="space-y-3 py-12">
        <BackToBrowse />
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
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BackToBrowse />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{profile?.name ?? id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
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
