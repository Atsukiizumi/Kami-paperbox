import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArtworkGrid } from "@/components/artwork-card";
import { BackToBrowse, BackToPrevious } from "@/components/back-to-browse";
import { EmptySheet } from "@/components/empty-sheet";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { WorkActions } from "@/components/work-actions";
import { ProxiedImg } from "@/components/proxied-img";
import { UgoiraPlayer } from "@/components/ugoira-player";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WorkTagList } from "@/components/saved-tags";
import { FoldableText } from "@/components/profile-header";
import { enqueueWork } from "@/lib/queue-runner";
import { flyPaperToQueue } from "@/lib/paper-fly";
import { fetchSource, mutateSource, warmPixivCsrf } from "@/lib/source";
import { cookiesFromSettings, useQueue, useSettings } from "@/lib/store";
import { fanboxSessionFrom } from "@/lib/browser-login";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { formatCount, formatResolution, mediaUrl } from "@/lib/utils";
import { workKey as vaultWorkKey } from "@/lib/vault";
import { useVaultIndex } from "@/lib/vault-index";
import { patchCachedWork } from "@/lib/work-cache";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseSource, workOriginUrl, isBooru } from "@/lib/sites";
import { canonicalTag } from "@/lib/site-tags";
import { pickRelatedTag } from "@/lib/booru";
import { stashReverseImage } from "@/lib/reverse-search";
import type { WorkDetail } from "@/lib/types";
import { rememberView } from "@/lib/view-history";

export const Route = createFileRoute("/work/$source/$id")({
  component: WorkPage,
});

function WorkPage() {
  const { source, id } = Route.useParams();
  const src = parseSource(source);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const savedTags = useSettings((s) => s.savedTags[src] ?? []);
  const toggleSavedTag = useSettings((s) => s.toggleSavedTag);
  const [preview, setPreview] = useState<number | null>(null);
  const likingRef = useRef(false);
  const inVault = useVaultIndex((s) => Boolean(s.keys[vaultWorkKey(src, id)]));
  const inQueue = useQueue((s) =>
    s.items.some((x) => x.key === vaultWorkKey(src, id) && (x.status === "queued" || x.status === "running")),
  );

  useEffect(() => {
    if (src === "pixiv") warmPixivCsrf(pixivCookie);
  }, [src, pixivCookie]);

  const query = useQuery({
    queryKey: ["work", src, id, safeMode, pixivCookie, fanboxCookie],
    queryFn: async () => {
      if (src === "pixiv") {
        const r = await fetchSource({
          data: { op: "pixivIllust", id, ...cookiesFromSettings() },
        });
        if (r.op !== "pixivIllust") throw new Error("返回异常");
        return r.work;
      }
      if (src === "fanbox") {
        const r = await fetchSource({
          data: { op: "fanboxPost", id, ...cookiesFromSettings() },
        });
        if (r.op !== "fanboxPost") throw new Error("返回异常");
        return r.work;
      }
      const r = await fetchSource({
        data: { op: "booruPost", site: src, id, ...cookiesFromSettings() },
      });
      if (r.op !== "booruPost") throw new Error("返回异常");
      return r.work;
    },
  });

  const relatedQuery = useQuery({
    queryKey: ["related", src, id, safeMode, hideAi, pixivCookie, query.data?.tags?.join(" ")],
    enabled: src === "pixiv" || (isBooru(src) && Boolean(query.data)),
    queryFn: async () => {
      if (src === "pixiv") {
        const r = await fetchSource({
          data: { op: "pixivRelated", id, ...cookiesFromSettings() },
        });
        if (r.op !== "pixivRelated") return [];
        return r.items.filter((item) => item.id !== id);
      }
      if (!isBooru(src) || !query.data) return [];
      const tag = pickRelatedTag(query.data.tags);
      if (!tag) return [];
      const r = await fetchSource({
        data: {
          op: "booruList",
          site: src,
          feed: "recent",
          tags: tag,
          page: 1,
          ...cookiesFromSettings(),
        },
      });
      if (r.op !== "booruList") return [];
      return r.items.filter((item) => item.id !== id).slice(0, 12);
    },
  });

  const work = query.data;

  useEffect(() => {
    if (!query.isSuccess || !query.data) return;
    rememberView(query.data);
  }, [src, id, query.isSuccess, query.data]);

  const lightboxItems: LightboxItem[] = useMemo(() => {
    if (!work) return [];
    if (work.ugoira) {
      return [
        {
          src: mediaUrl(work.pages[0]?.regular || work.thumb),
          alt: work.title,
          ugoira: { zipUrl: work.ugoira.src, frames: work.ugoira.frames },
          caption: formatResolution(work.width, work.height),
        },
      ];
    }
    return work.pages.map((page, i) => ({
      src: mediaUrl(page.regular || page.original),
      alt: `${work.title} ${i + 1}`,
      caption: formatResolution(page.width, page.height),
    }));
  }, [work]);

  async function searchFromWork(detail: WorkDetail) {
    const src = detail.pages[0]?.regular || detail.pages[0]?.original || detail.thumb;
    if (!src) {
      toast.error("这张作品没有可搜的预览图");
      return;
    }
    try {
      const res = await fetch(mediaUrl(src));
      if (!res.ok) throw new Error("读不到预览图");
      const blob = await res.blob();
      const bytes = await blob.arrayBuffer();
      stashReverseImage({
        name: `${detail.id}.jpg`,
        type: blob.type || "image/jpeg",
        bytes,
      });
      void navigate({ to: "/search" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "无法用来搜图");
    }
  }

  const workKey = ["work", src, id, safeMode, pixivCookie, fanboxCookie] as const;

  function patchWork(partial: Partial<WorkDetail>) {
    queryClient.setQueryData<WorkDetail>(workKey, (old) => (old ? { ...old, ...partial } : old));
    patchCachedWork(queryClient, src, id, partial);
  }

  async function doLike(detail: WorkDetail) {
    if (detail.liked || likingRef.current) {
      if (detail.liked) toast.success("已经点过红心");
      return;
    }
    if (src === "pixiv" && !pixivCookie) {
      toast.error("先在设置里添加 Pixiv 账号");
      return;
    }
    if (src === "fanbox" && !fanboxCookie) {
      toast.error("先在设置里添加 FANBOX 账号");
      return;
    }
    likingRef.current = true;
    const prevLikes = detail.likes;
    const prevBookmarked = detail.bookmarked;
    const prevBookmarkId = detail.bookmarkId;
    patchWork({ liked: true, bookmarked: true, likes: (prevLikes ?? 0) + 1 });
    try {
      if (src === "pixiv") {
        const r = await mutateSource({
          data: { op: "pixivLike", id: detail.id, tags: detail.tags, ...cookiesFromSettings() },
        });
        patchWork({
          liked: true,
          bookmarked: r.bookmarked ?? true,
          bookmarkId: r.bookmarkId ?? prevBookmarkId,
        });
      } else if (src === "fanbox") {
        await mutateSource({ data: { op: "fanboxLike", id: detail.id, ...cookiesFromSettings() } });
      }
    } catch (err) {
      patchWork({ liked: false, bookmarked: prevBookmarked, bookmarkId: prevBookmarkId, likes: prevLikes });
      toast.error(err instanceof Error ? err.message : "红心失败");
    } finally {
      likingRef.current = false;
    }
  }

  async function doBookmark(detail: WorkDetail) {
    if (src !== "pixiv") return;
    if (!pixivCookie) {
      toast.error("先在设置里添加 Pixiv 账号");
      return;
    }
    try {
      const on = !detail.bookmarked;
      const r = await mutateSource({
        data: {
          op: "pixivBookmark",
          id: detail.id,
          on,
          tags: on ? detail.tags : undefined,
          bookmarkId: detail.bookmarkId,
          ...cookiesFromSettings(),
        },
      });
      patchWork({
        bookmarked: r.bookmarked,
        bookmarkId: r.bookmarkId,
        bookmarks: Math.max(0, (detail.bookmarks ?? 0) + (on ? 1 : -1)),
      });
      toast.success(on ? "已收藏，并带上作品标签" : "已取消收藏");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "收藏失败");
    }
  }

  async function doFollow(detail: WorkDetail) {
    try {
      if (src === "pixiv") {
        if (!pixivCookie) {
          toast.error("先在设置里添加 Pixiv 账号");
          return;
        }
        const on = !detail.followed;
        await mutateSource({
          data: { op: "pixivFollow", userId: detail.authorId, on, ...cookiesFromSettings() },
        });
        patchWork({ followed: on });
        toast.success(on ? `已关注 ${detail.author}` : "已取消关注");
      } else if (src === "fanbox") {
        if (!fanboxCookie) {
          toast.error("先在设置里添加 FANBOX 账号");
          return;
        }
        const on = !detail.followed;
        await mutateSource({
          data: {
            op: "fanboxFollow",
            creatorId: detail.authorId,
            on,
            ...cookiesFromSettings(),
          },
        });
        patchWork({ followed: on });
        toast.success(on ? `已关注 ${detail.author}` : "已取消关注");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "关注失败");
    }
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-[3/4] w-full max-w-md rounded-xl" />
      </div>
    );
  }

  if (query.error || !work) {
    return (
      <div className="space-y-3 py-10">
        <Alert variant="danger">
          <AlertTitle>无法打开作品</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : "请检查链接，或在设置中填入登录 Cookie。"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }


  const originUrl = workOriginUrl(src, work.id, work.authorId);

  function searchTag(tag: string) {
    const word = canonicalTag(src, tag) || tag;
    setTab(src);
    setBrowseQuery(word, true);
    void navigate({ to: "/" });
  }

  function queueNow(kind: "download" | "vault") {
    if (!work) return;
    enqueueWork(work, kind);
    const media = document.querySelector(".kami-work-stage");
    flyPaperToQueue(media?.getBoundingClientRect());
    toast.success(kind === "vault" ? "已加入队列：收入纸匣" : "已加入队列：下载");
  }

  const actions = (
    <WorkActions
      work={work}
      inVault={inVault}
      inQueue={inQueue}
      originUrl={originUrl}
      onSave={() => queueNow("vault")}
      onDownload={() => queueNow("download")}
      onSearchOrigin={() => void searchFromWork(work)}
      onBookmark={() => void doBookmark(work)}
      onLike={() => void doLike(work)}
      onFollow={() => void doFollow(work)}
    />
  );

  return (
    <article>
      <div className="kami-work-sticky -mx-4 flex flex-wrap items-center gap-2 border-b border-border/70 bg-bg/85 px-4 py-1.5 backdrop-blur-md md:-mx-10 md:px-10">
        <BackToPrevious />
        <BackToBrowse />
        <div className="min-w-0 md:ml-auto">{actions}</div>
      </div>

      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
        <h1 className="font-display text-xl leading-tight tracking-tight md:text-2xl">{work.title}</h1>
        {src === "pixiv" ? (
          <Link to="/user/$id" params={{ id: work.authorId }} className="text-sm text-muted hover:text-fg hover:underline">
            {work.author}
          </Link>
        ) : src === "fanbox" ? (
          <Link
            to="/creator/$id"
            params={{ id: work.authorId }}
            className="text-sm text-muted hover:text-fg hover:underline"
          >
            {work.author}
          </Link>
        ) : (
          <button
            type="button"
            className="text-sm text-muted hover:text-fg hover:underline"
            onClick={() => searchTag(work.author)}
          >
            {work.author}
          </button>
        )}
        {work.pageCount > 1 ? <Badge>{work.pageCount} 页</Badge> : null}
        {formatResolution(work.width, work.height) ? (
          <span className="text-xs tabular-nums text-subtle">{formatResolution(work.width, work.height)}</span>
        ) : null}
        {work.illustType === 2 || work.ugoira ? <Badge>动图 GIF</Badge> : null}
        {work.aiType === 2 ? <Badge>AI</Badge> : null}
        {work.views ? <span className="text-xs tabular-nums text-subtle">浏览 {formatCount(work.views)}</span> : null}
        {work.bookmarks ? (
          <span className="text-xs tabular-nums text-subtle">收藏 {formatCount(work.bookmarks)}</span>
        ) : null}
      </header>

      {work.restricted ? (
        <Alert className="mb-4">
          <AlertTitle>需要订阅</AlertTitle>
          <AlertDescription>
            这篇投稿需要订阅才能查看附件。在设置里填入你的 FANBOXSESSID（需已订阅该创作者）后再打开。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="kami-work-stage -mx-4 md:-mx-10">
        {work.ugoira ? (
          <figure className="overflow-hidden">
            <UgoiraPlayer
              zipUrl={work.ugoira.src}
              frames={work.ugoira.frames}
              alt={work.title}
              onOpen={() => setPreview(0)}
            />
          </figure>
        ) : (
          work.pages.map((page, i) => (
            <figure key={`${page.original}-${i}`} className="kami-enter">
              <button
                type="button"
                className="block w-full cursor-zoom-in"
                onClick={() => setPreview(i)}
              >
                <ProxiedImg
                  src={page.regular || page.original}
                  alt={`${work.title} ${i + 1}`}
                  fit="contain"
                  priority={i === 0}
                  sizes="100vw"
                  viewTransitionName={i === 0 ? `kami-${work.source}-${work.id}` : undefined}
                  className="mx-auto max-h-[92vh]"
                />
              </button>
              {formatResolution(page.width, page.height) || work.pages.length > 1 ? (
                <figcaption className="px-3 py-1.5 text-center text-xs tabular-nums text-subtle">
                  {formatResolution(page.width, page.height)}
                  {work.pages.length > 1 ? ` · ${i + 1}/${work.pages.length}` : ""}
                </figcaption>
              ) : null}
            </figure>
          ))
        )}
      </div>

      <div className="mx-auto max-w-3xl space-y-4 pt-6">
        {work.tags.length > 0 ? (
          <WorkTagList
            source={src}
            tags={work.tags}
            saved={savedTags}
            onSearch={searchTag}
            onToggle={(tag) => toggleSavedTag(src, tag)}
          />
        ) : null}
        {work.description ? <FoldableText text={work.description} lines={4} /> : null}
      </div>

      <ImageLightbox
        items={lightboxItems}
        index={preview ?? 0}
        open={preview !== null}
        onClose={() => setPreview(null)}
        onIndex={setPreview}
        originUrl={originUrl}
        footer={
          <WorkActions
            work={work}
            compact
            originUrl={originUrl}
            inVault={inVault}
            inQueue={inQueue}
            onSave={() => queueNow("vault")}
            onDownload={() => queueNow("download")}
            onBookmark={() => void doBookmark(work)}
            onLike={() => void doLike(work)}
            onFollow={() => void doFollow(work)}
          />
        }
      />

      {(src === "pixiv" || isBooru(src)) ? (
        <section className="space-y-3 pt-8">
          <h2 className="text-lg font-semibold">相关推荐</h2>
          {relatedQuery.isLoading ? (
            <p className="text-sm text-muted">正在折下一叠…</p>
          ) : (relatedQuery.data?.length ?? 0) > 0 ? (
            <ArtworkGrid items={relatedQuery.data ?? []} />
          ) : (
            <EmptySheet title="没有更多" hint="这篇下面没有可排的相关作品。" className="py-10" />
          )}
        </section>
      ) : null}
    </article>
  );
}
