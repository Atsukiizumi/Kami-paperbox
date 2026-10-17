"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { credentialTag } from "@/lib/sync/cred-tag";
import { fetchWorkDetail, workDetailQueryKey } from "@/lib/work-detail";
import { Link, useNavigate, useParams } from "@/lib/kami-link";
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
import { WorkStats } from "@/components/work-stats";
import { FoldableText } from "@/components/profile-header";
import { enqueueWork } from "@/lib/queue-runner";
import { copyWorkImage, isGifWork } from "@/lib/copy-image";
import { flyPaperToQueue } from "@/lib/paper-fly";
import { fetchSource, mutateSource, warmPixivCsrf } from "@/lib/source";
import { cookiesFromSettings, useQueue, useSettings } from "@/lib/store";
import { fanboxSessionFrom } from "@/lib/sync/browser-login";
import { formatCount, formatResolution, mediaUrl, cn } from "@/lib/utils";
import { shouldVeil, useVeil } from "@/lib/veil";
import { workKey as vaultWorkKey } from "@/lib/storage/vault";
import { useVaultIndex } from "@/lib/storage/vault-index";
import { patchCachedWork } from "@/lib/work-cache";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseSource, workOriginUrl, isBooru, xHandleFromAuthor } from "@/lib/sites";
import { canonicalTag } from "@/lib/site-tags";
import { pickRelatedTag } from "@/lib/booru";
import { stashReverseImage } from "@/lib/reverse-search";
import type { WorkDetail, Source } from "@/lib/types";
import { rememberView, resumePage, useViewHistory } from "@/lib/view-history";
import { collectBooruTags } from "@/lib/tag-catalog";

export function WorkPage() {
  const { source, id } = useParams<{ source: string; id: string }>();
  // x 不在 SITE_LIST（不是浏览站，D2），parseSource 会误吞成 pixiv——这里显式放行
  const src: Source = source === "x" ? "x" : parseSource(source);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  // 相关作品跟着本页站点自己的 R-18 开关走
  const safeMode = useSettings((s) => s.safeModeBySite[src]);
  const hideAi = useSettings((s) => s.hideAi);
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const savedTags = useSettings((s) => s.savedTags[src] ?? []);
  const toggleSavedTag = useSettings((s) => s.toggleSavedTag);
  const [preview, setPreview] = useState<number | null>(null);
  // 访客遮盖（U）：R-18 / AI 作品大图模糊，逐张点击临时揭示；Esc 全局关（AppShell）
  const veil = useVeil((s) => s.veil);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const likingRef = useRef(false);
  const inVault = useVaultIndex((s) => Boolean(s.keys[vaultWorkKey(src, id)]));
  const inQueue = useQueue((s) =>
    s.items.some((x) => x.key === vaultWorkKey(src, id) && (x.status === "queued" || x.status === "running")),
  );

  useEffect(() => {
    if (src === "pixiv") warmPixivCsrf(pixivCookie);
  }, [src, pixivCookie]);

  const query = useQuery({
    queryKey: workDetailQueryKey(src, id),
    queryFn: () => fetchWorkDetail(src, id),
  });

  const relatedQuery = useQuery({
    queryKey: ["related", src, id, safeMode, hideAi, credentialTag(pixivCookie), query.data?.tags?.join(" ")],
    enabled: src === "pixiv" || (isBooru(src) && Boolean(query.data)),
    queryFn: async () => {
      if (src === "pixiv") {
        const r = await fetchSource({
          data: { op: "pixivRelated", id, ...cookiesFromSettings("pixiv") },
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
          ...cookiesFromSettings(src),
        },
      });
      if (r.op !== "booruList") return [];
      return r.items.filter((item) => item.id !== id).slice(0, 12);
    },
  });

  const work = query.data;
  const workVeiled = Boolean(veil && work && shouldVeil(work));

  useEffect(() => {
    if (!query.isSuccess || !query.data) return;
    rememberView(query.data);
    collectBooruTags(query.data.source, query.data.tags);
  }, [src, id, query.isSuccess, query.data]);

  // 续读定位（M2）：query 成功后读一次历史水位（getState 不订阅历史，避免多余重渲），
  // resumePage 判定值得定位（翻到中途）才滚动。didLocateRef 按 source:id 一次性：
  // rememberView 回填 / 点赞收藏 patch 让 work 换新身份重跑本 effect，不得二次滚动。
  const didLocateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!query.isSuccess || !query.data) return;
    const key = `${src}:${id}`;
    if (didLocateRef.current === key) return;
    didLocateRef.current = key;
    const entry = useViewHistory.getState().items.find((x) => x.source === src && x.id === id);
    const page = resumePage(entry, query.data.pageCount);
    if (page === null) return;
    document
      .querySelector(`[data-work-page="${page}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [src, id, query.isSuccess, query.data]);

  const lightboxItems: LightboxItem[] = useMemo(() => {
    if (!work) return [];
    const images = work.pages.filter((page) => page.kind !== "file");
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
    return images.map((page, i) => ({
      // 灯箱主图用原图（regular 是 ~1200px 中档，全屏/放大就糊）；缩略图条用中档省流量。
      src: mediaUrl(page.original || page.regular),
      thumb: mediaUrl(page.regular || page.original),
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

  function patchWork(partial: Partial<WorkDetail>) {
    // 键必须和 useQuery 的完全一致（带 safeMode 和凭据指纹），否则乐观更新
    // 写进一条永远没人读的缓存。
    const key = workDetailQueryKey(src, id);
    queryClient.setQueryData<WorkDetail>(key, (old) => (old ? { ...old, ...partial } : old));
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
          data: { op: "pixivLike", id: detail.id, tags: detail.tags, ...cookiesFromSettings("pixiv") },
        });
        patchWork({
          liked: true,
          bookmarked: r.bookmarked ?? true,
          bookmarkId: r.bookmarkId ?? prevBookmarkId,
        });
      } else if (src === "fanbox") {
        await mutateSource({ data: { op: "fanboxLike", id: detail.id, ...cookiesFromSettings("fanbox") } });
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
          ...cookiesFromSettings("pixiv"),
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
          data: { op: "pixivFollow", userId: detail.authorId, on, ...cookiesFromSettings("pixiv") },
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
            ...cookiesFromSettings("fanbox"),
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


  // x 的 authorId 是 restId（身份键），原推链接要 handle——与 CardMenu 同口径
  // 从 author「显示名@handle」尾巴取回；取不到 workOriginUrl 自退 intent 链接
  const originUrl = workOriginUrl(
    src,
    work.id,
    src === "x" ? (xHandleFromAuthor(work.author) ?? work.authorId) : work.authorId,
  );

  function searchTag(tag: string) {
    const word = canonicalTag(src, tag) || tag;
    setTab(src);
    setBrowseQuery(word, true);
    void navigate({ to: "/browse" });
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
      onCopy={isGifWork(work) ? () => void copyWorkImage(work, { inVault }) : undefined}
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
        ) : src === "x" ? (
          // author 是「显示名@handle」（映射层藏 handle 的口径）：回链 X 预览页；
          // 取不到 handle（异常数据）退纯文本
          xHandleFromAuthor(work.author) ? (
            <Link
              to={`/x/${xHandleFromAuthor(work.author)}`}
              className="text-sm text-muted hover:text-fg hover:underline"
            >
              {work.author}
            </Link>
          ) : (
            <span className="text-sm text-muted">{work.author}</span>
          )
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
      <WorkStats work={work} onAuthor={searchTag} />
      {isBooru(src) && work.pools && work.pools.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-3 text-sm text-muted">
          <span className="text-subtle">合集</span>
          {work.pools.map((pool) => (
            <Link
              key={pool.id}
              to="/pool/$site/$id"
              params={{ site: src, id: pool.id }}
              className="hover:text-fg hover:underline"
            >
              {pool.name}
            </Link>
          ))}
        </p>
      ) : null}

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
          <figure className={cn("overflow-hidden", workVeiled && !revealed.has(0) && "blur-xl")}>
            <UgoiraPlayer
              zipUrl={work.ugoira.src}
              frames={work.ugoira.frames}
              alt={work.title}
              onOpen={() => {
                if (workVeiled && !revealed.has(0)) {
                  setRevealed((prev) => new Set(prev).add(0));
                  return;
                }
                setPreview(0);
              }}
            />
          </figure>
        ) : (
          work.pages.map((page, i) => (
            page.kind === "file" ? (
              <figure key={`${page.original}-${i}`} className="kami-enter rounded-xl bg-elevated px-4 py-3">
                <a
                  href={mediaUrl(page.original || page.regular)}
                  className="text-sm text-fg underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {page.name || `附件 ${i + 1}`}
                </a>
                {page.bytes ? (
                  <p className="mt-1 text-xs text-subtle">{Math.round(page.bytes / 1024)} KB</p>
                ) : null}
              </figure>
            ) : (
            <figure key={`${page.original}-${i}`} className="kami-enter" data-work-page={i}>
              {/* data-work-page 用 pages.map 的原索引（:408 口径）：水位/定位/正文点击
                  三者同 setPreview(i) 一套索引；附件混排的灯箱索引错位是既有事实，不修 */}
              <button
                type="button"
                className="block w-full cursor-zoom-in"
                onClick={() => {
                  // 遮盖中先揭示本张（临时查看），再点才进灯箱
                  if (workVeiled && !revealed.has(i)) {
                    setRevealed((prev) => new Set(prev).add(i));
                    return;
                  }
                  setPreview(i);
                }}
              >
                <ProxiedImg
                  src={page.regular || page.original}
                  alt={`${work.title} ${i + 1}`}
                  fit="contain"
                  priority={i === 0}
                  sizes="100vw"
                  viewTransitionName={i === 0 ? `kami-${work.source}-${work.id}` : undefined}
                  className={cn("mx-auto max-h-[92vh]", workVeiled && !revealed.has(i) ? "blur-xl" : "")}
                />
              </button>
              {formatResolution(page.width, page.height) || work.pages.length > 1 ? (
                <figcaption className="px-3 py-1.5 text-center text-xs tabular-nums text-subtle">
                  {formatResolution(page.width, page.height)}
                  {work.pages.length > 1 ? ` · ${i + 1}/${work.pages.length}` : ""}
                </figcaption>
              ) : null}
            </figure>
            )
          ))
        )}
      </div>

      <div className="mx-auto max-w-3xl space-y-4 pt-6">
        {work.tags.length > 0 ? (
          // x 的 hashtag 不是任何浏览站的搜索词（X 不是浏览站，D2）——点标签
          // setTab("x") 会把浏览页带进非法站；退成静态展示
          src === "x" ? (
            <p className="flex flex-wrap gap-1.5">
              {work.tags.map((tag) => (
                <Badge key={tag}>#{tag}</Badge>
              ))}
            </p>
          ) : (
            <WorkTagList
              source={src}
              tags={work.tags}
              saved={savedTags}
              onSearch={searchTag}
              onToggle={(tag) => toggleSavedTag(src, tag)}
            />
          )
        ) : null}
        {work.description && !(work.originSource && work.description === `来源 ${work.originSource}`) ? (
          <FoldableText text={work.description} lines={4} />
        ) : null}
      </div>

      <ImageLightbox
        items={lightboxItems}
        index={preview ?? 0}
        open={preview !== null}
        onClose={() => {
          // 关灯箱写一次续读水位（M2 单一写点）：灯箱四路翻页全汇 onIndex=setPreview，
          // 闭包里的 preview 就是最后浏览页（Esc/遮罩/关闭钮同源）；纯滚动正文不记。
          if (preview !== null && work.pageCount > 1) {
            useViewHistory.getState().setLastPage(src, id, Math.min(preview, work.pageCount - 1));
          }
          setPreview(null);
        }}
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
            onCopy={isGifWork(work) ? () => void copyWorkImage(work, { inVault }) : undefined}
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
