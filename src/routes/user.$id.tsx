"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { credentialTag } from "@/lib/sync/cred-tag";
import { useParams } from "@/lib/kami-link";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { FoldableText, ProfileAvatar } from "@/components/profile-header";
import { WatchToggle } from "@/components/watch-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchSource, mutateSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { formatCount } from "@/lib/utils";
import { rememberAuthor } from "@/lib/view-history";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Layers, UserMinus, UserPlus } from "lucide-react";
import { enqueueWorks } from "@/lib/queue-runner";
import { BATCH_MAX, filterBatchable, workKeyOf } from "@/lib/batch-collect";
import { useQueue } from "@/lib/store";
import { useVaultIndex } from "@/lib/storage/vault-index";
import { BatchToolbar } from "@/components/batch-toolbar";

export function UserPage() {
  const { id } = useParams<{ id: string }>();
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const queryClient = useQueryClient();
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

  // M9/TD-23 教训成规：写路径（setQueryData）与读路径共用同一个 key 实例。
  const userQueryKey = useMemo(
    () => ["user", id, safeMode, hideAi, credentialTag(pixivCookie)],
    [id, safeMode, hideAi, pixivCookie],
  );

  const query = useInfiniteQuery({
    queryKey: userQueryKey,
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
  const allCards = [...pinned, ...items];

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
    const cards = allCards.filter((c) => selected.has(workKeyOf(c)));
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
                  queryClient.setQueryData(userQueryKey, (old: unknown) => {
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
          <WatchToggle source="pixiv" id={profile.id} name={profile.name} avatar={profile.avatar} />
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
            selection={batchMode ? { selected, onToggle: toggleSelected } : undefined}
          />
        </section>
      ) : null}
      <section className="space-y-3">
        {pinned.length > 0 ? <h2 className="text-sm font-medium text-muted">作品</h2> : null}
        <ArtworkGrid
          items={items}
          marksOf={(work) => (work.id === newestId ? ["最新"] : undefined)}
          selection={batchMode ? { selected, onToggle: toggleSelected } : undefined}
        />
        <InfiniteSentinel
          disabled={!query.hasNextPage || query.isFetchingNextPage}
          onVisible={() => void query.fetchNextPage()}
        />
      </section>
      {batchMode ? (
        <BatchToolbar
          selectedCount={selected.size}
          total={allCards.length}
          onSelectAll={() => setSelected(new Set(allCards.map(workKeyOf)))}
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
