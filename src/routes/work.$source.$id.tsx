import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { ArtworkGrid } from "@/components/artwork-card";
import { BackToBrowse } from "@/components/back-to-browse";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { WorkActions } from "@/components/work-actions";
import { ProxiedImg } from "@/components/proxied-img";
import { UgoiraPlayer } from "@/components/ugoira-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { WorkTagList } from "@/components/saved-tags";
import { enqueueWork } from "@/lib/queue-runner";
import { collectWorkFiles } from "@/lib/save-work";
import { fetchSource, mutateSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { fanboxSessionFrom } from "@/lib/browser-login";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { formatCount, mediaUrl } from "@/lib/utils";
import { archiveWork } from "@/lib/persist-files";
import { useMemo, useState } from "react";
import { parseSource, siteLabel, workOriginUrl, isBooru } from "@/lib/sites";
import { canonicalTag } from "@/lib/site-tags";
import { pickRelatedTag } from "@/lib/booru";
import { stashReverseImage } from "@/lib/reverse-search";
import type { WorkDetail } from "@/lib/types";

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
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<number | null>(null);

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

  const lightboxItems: LightboxItem[] = useMemo(() => {
    if (!work) return [];
    if (work.ugoira) {
      return [
        {
          src: mediaUrl(work.pages[0]?.regular || work.thumb),
          alt: work.title,
          ugoira: { zipUrl: work.ugoira.src, frames: work.ugoira.frames },
        },
      ];
    }
    return work.pages.map((page, i) => ({
      src: mediaUrl(page.regular || page.original),
      alt: `${work.title} ${i + 1}`,
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

  async function saveNow(detail: WorkDetail, alsoDownload: boolean) {
    if (detail.restricted) {
      toast.error("需要有效订阅才能保存这篇投稿");
      return;
    }
    setSaving(true);
    setProgress(detail.ugoira ? "正在合成 GIF…" : "");
    try {
      const original = useSettings.getState().downloadOriginal;
      const blobs = await collectWorkFiles(detail, {
        original,
        onProgress: (done, total) => {
          setProgress(detail.ugoira ? `合成 GIF ${done}/${total}` : `保存 ${done}/${total}`);
        },
      });
      const result = await archiveWork(detail, blobs, { download: alsoDownload });
      const gif = blobs.some((s) => extFromNameOrType(s.page.name, s.blob.type) === "gif");
      const skipped = result.folderSkipped ? "，文件夹未授权" : "";
      if (result.folder) {
        toast.success(gif ? "GIF 已收入纸匣并写入文件夹" : "已收入纸匣并写入文件夹");
      } else if (alsoDownload) {
        toast.success((gif ? "GIF 已下载并收入纸匣" : "已下载并收入纸匣") + skipped);
      } else {
        toast.success((gif ? "GIF 已收入纸匣" : "已收入纸匣") + skipped);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
      setProgress("");
    }
  }

  const workKey = ["work", src, id, safeMode, pixivCookie, fanboxCookie] as const;

  function patchWork(partial: Partial<WorkDetail>) {
    queryClient.setQueryData<WorkDetail>(workKey, (old) => (old ? { ...old, ...partial } : old));
  }

  async function doLike(detail: WorkDetail) {
    if (detail.liked) {
      toast.success("已经点过红心");
      return;
    }
    try {
      if (src === "pixiv") {
        if (!pixivCookie) {
          toast.error("先在设置里添加 Pixiv 账号");
          return;
        }
        await mutateSource({ data: { op: "pixivLike", id: detail.id, ...cookiesFromSettings() } });
      } else if (src === "fanbox") {
        if (!fanboxCookie) {
          toast.error("先在设置里添加 FANBOX 账号");
          return;
        }
        await mutateSource({ data: { op: "fanboxLike", id: detail.id, ...cookiesFromSettings() } });
      }
      patchWork({ liked: true, likes: (detail.likes ?? 0) + 1 });
      toast.success("已点红心");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "红心失败");
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
        <BackToBrowse />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-[3/4] w-full max-w-md rounded-xl" />
      </div>
    );
  }

  if (query.error || !work) {
    return (
      <div className="space-y-3 py-10">
        <BackToBrowse />
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

  return (
    <article className="space-y-6">
      <header className="space-y-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BackToBrowse />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>{siteLabel(src)}</BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{work.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="font-display text-3xl leading-tight tracking-tight md:text-4xl">{work.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {src === "pixiv" ? (
            <Link to="/user/$id" params={{ id: work.authorId }} className="text-fg hover:underline">
              {work.author}
            </Link>
          ) : src === "fanbox" ? (
            <Link
              to="/creator/$id"
              params={{ id: work.authorId }}
              className="text-fg hover:underline"
            >
              {work.author}
            </Link>
          ) : (
            <span className="text-fg">{work.author}</span>
          )}
          {work.pageCount > 1 ? <Badge>{work.pageCount} 页</Badge> : null}
          {work.illustType === 2 || work.ugoira ? <Badge>动图 GIF</Badge> : null}
          {work.aiType === 2 ? <Badge>AI</Badge> : null}
          {work.views ? <span className="tabular-nums">浏览 {formatCount(work.views)}</span> : null}
          {work.bookmarks ? (
            <span className="tabular-nums">收藏 {formatCount(work.bookmarks)}</span>
          ) : null}
        </div>
        <a
          href={originUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 text-xs text-subtle hover:text-fg"
        >
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{originUrl}</span>
        </a>
        {work.tags.length > 0 ? (
          <WorkTagList
            source={src}
            tags={work.tags}
            saved={savedTags}
            onSearch={searchTag}
            onToggle={(tag) => toggleSavedTag(src, tag)}
          />
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <WorkActions
          work={work}
          saving={saving}
          originUrl={originUrl}
          onSave={() => void saveNow(work, false)}
          onDownload={() => void saveNow(work, true)}
          onBookmark={() => void doBookmark(work)}
          onLike={() => void doLike(work)}
          onFollow={() => void doFollow(work)}
        />
        <Button
          variant="ghost"
          disabled={saving || work.restricted}
          onClick={() => enqueueWork(work)}
        >
          加入队列
        </Button>
        <Button
          variant="ghost"
          disabled={work.restricted}
          onClick={() => void searchFromWork(work)}
        >
          <ScanSearch className="size-4" />
          搜来源
        </Button>
      </div>
      {progress ? <p className="text-xs tabular-nums text-subtle">{progress}</p> : null}

      {work.restricted ? (
        <Alert>
          <AlertTitle>需要订阅</AlertTitle>
          <AlertDescription>
            这篇投稿需要订阅才能查看附件。在设置里填入你的 FANBOXSESSID（需已订阅该创作者）后再打开。
          </AlertDescription>
        </Alert>
      ) : null}

      {work.description ? (
        <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {work.description.slice(0, 1200)}
        </p>
      ) : null}

      <div className="space-y-4">
        {work.ugoira ? (
          <figure className="overflow-hidden rounded-lg bg-surface">
            <UgoiraPlayer
              zipUrl={work.ugoira.src}
              frames={work.ugoira.frames}
              alt={work.title}
              onOpen={() => setPreview(0)}
            />
          </figure>
        ) : (
          work.pages.map((page, i) => (
            <figure key={`${page.original}-${i}`} className="rounded-lg bg-surface">
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
                  sizes="(max-width: 1100px) 100vw, 900px"
                  className="max-h-[85vh]"
                />
              </button>
            </figure>
          ))
        )}
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
            saving={saving}
            onSave={() => void saveNow(work, false)}
            onDownload={() => void saveNow(work, true)}
            onBookmark={() => void doBookmark(work)}
            onLike={() => void doLike(work)}
            onFollow={() => void doFollow(work)}
          />
        }
      />

      {(src === "pixiv" || isBooru(src)) && (relatedQuery.data?.length ?? 0) > 0 ? (
        <section className="space-y-3 pt-4">
          <h2 className="text-lg font-semibold">相关推荐</h2>
          <ArtworkGrid items={relatedQuery.data ?? []} />
        </section>
      ) : null}
    </article>
  );
}
