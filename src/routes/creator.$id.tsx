"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { credentialTag } from "@/lib/cred-tag";
import { useParams } from "@/lib/kami-link";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { FoldableText, ProfileAvatar } from "@/components/profile-header";
import { WatchToggle } from "@/components/watch-toggle";
import { BatchToolbar } from "@/components/batch-toolbar";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useQueue, useSettings } from "@/lib/store";
import { fanboxSessionFrom } from "@/lib/browser-login";
import { rememberAuthor } from "@/lib/view-history";
import { enqueueWorks } from "@/lib/queue-runner";
import { BATCH_MAX, filterBatchable, workKeyOf } from "@/lib/batch-collect";
import { useVaultIndex } from "@/lib/vault-index";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import type { FanboxCursor, WorkCard } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

export function CreatorPage() {
  const { id } = useParams<{ id: string }>();
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const safeMode = useSettings((s) => s.safeMode);
  // 批量收藏（D）
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const vaultKeys = useVaultIndex((s) => s.keys);
  const queueItems = useQueue((s) => s.items);
  const queueKeys = useMemo(
    () => queueItems.filter((x) => x.status === "queued" || x.status === "running").map((x) => x.key),
    [queueItems],
  );

  const query = useInfiniteQuery({
    queryKey: ["creator", id, safeMode, credentialTag(fanboxCookie)],
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

  // 批量收藏（D）
  function countLoaded(data: typeof query.data): number {
    return (data?.pages ?? []).reduce((sum, page) => sum + page.items.length, 0);
  }
  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  async function loadToCap() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      let guard = 0;
      let res = await query.fetchNextPage();
      while (res.hasNextPage && guard < 30 && countLoaded(res.data) < BATCH_MAX) {
        res = await query.fetchNextPage();
        guard += 1;
      }
      if (countLoaded(res.data) >= BATCH_MAX) toast.info(`已达单批上限 ${BATCH_MAX} 张`);
    } catch {
      toast.error("加载更多失败，已加载部分仍可选择");
    } finally {
      setLoadingMore(false);
    }
  }
  function enqueueSelected(kind: "vault" | "download") {
    const cards = items.filter((c) => selected.has(workKeyOf(c)));
    const { batchable, skippedVault, skippedQueue } = filterBatchable(cards, {
      inVaultKeys: new Set(Object.keys(vaultKeys)),
      inQueueKeys: new Set(queueKeys),
    });
    enqueueWorks(batchable, kind);
    const skipped: string[] = [];
    if (skippedVault) skipped.push(`已在纸匣 ${skippedVault}`);
    if (skippedQueue) skipped.push(`队列中 ${skippedQueue}`);
    toast.success(
      `${kind === "vault" ? "已入队：纸匣" : "已入队：下载"} ${batchable.length} 张${skipped.length ? `（跳过 ${skipped.join("、")}）` : ""}`,
    );
    setSelected(new Set());
    setBatchMode(false);
  }
  const gridSelection = batchMode ? { selected, onToggle: toggleSelected } : undefined;

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
          <div className="flex flex-wrap gap-2">
            <WatchToggle source="fanbox" id={profile?.id ?? id} name={profile?.name ?? id} avatar={profile?.avatar ?? ""} />
            <Button
              size="sm"
              variant={batchMode ? "default" : "outline"}
              className="mt-2"
              onClick={() => {
                setBatchMode((v) => !v);
                setSelected(new Set());
              }}
            >
              <Layers className="size-4" />
              {batchMode ? "退出批量" : "批量收藏"}
            </Button>
            {batchMode ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => void loadToCap()} disabled={loadingMore}>
                {loadingMore ? "加载中…" : `加载至 ${BATCH_MAX} 张`}
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <ArtworkGrid items={items} selection={gridSelection} />
      <InfiniteSentinel
        disabled={!query.hasNextPage || query.isFetchingNextPage}
        onVisible={() => void query.fetchNextPage()}
      />
      {batchMode ? (
        <BatchToolbar
          selectedCount={selected.size}
          total={items.length}
          onSelectAll={() => setSelected(new Set(items.map(workKeyOf)))}
          onClear={() => setSelected(new Set())}
          onEnqueue={enqueueSelected}
          onDone={() => {
            setBatchMode(false);
            setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}
