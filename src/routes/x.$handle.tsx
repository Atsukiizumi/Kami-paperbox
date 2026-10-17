"use client";

/**
 * X 预览页（路由 /x/{handle}，X 账号关联 M6，R4/AC3）。
 *
 * 作用：按关联 handle 浏览画师的 X 原创媒体时间线（卡片网格 + 光标无限加载），
 *       人工甄别后单张（卡面按钮）/ 批量（BatchToolbar）经现有队列落纸匣
 *       （source="x"，队列回源走 xTweet，M6 接线）。
 * 为什么是独立路由不是第六浏览站：X 是「画师的附属视图」，入口只在画师页
 *       「X 关联」卡（design D2），SITE_LIST 不动。
 * 卡面：sensitive 角标 / 多图计数 / 推文文字截断题注都走 ArtworkCard 既有
 *       视觉（xRestrict→R-18 角标、pageCount→Np、title≈80 字截断）；右键卡
 *       菜单「原站」= workOriginUrl 原推链接（CardMenu 已按 x 处理）。
 * 无 Cookie / Cookie 失效：内联引导卡 + 直达 设置→账号 锚点，不静默空态（AC3）。
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { ArrowLeft, Layers } from "lucide-react";
import { Link, useParams } from "@/lib/kami-link";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { ProfileAvatar } from "@/components/profile-header";
import { BatchToolbar } from "@/components/batch-toolbar";
import { useBatchSelection } from "@/components/use-batch-selection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { credentialTag } from "@/lib/sync/cred-tag";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useQueue, useSettings, useSettingsHydrated } from "@/lib/store";
import { sanitizeXCookie } from "@/lib/x-settings";
import { findXLinkedAuthorId, isXCookieGuideMessage, xMediaQueryKey, X_MEDIA_STALE_MS } from "@/lib/x-media";
import { BATCH_MAX, filterBatchable, workKeyOf } from "@/lib/batch-collect";
import { enqueueWorks } from "@/lib/queue-runner";
import { formatBatchEnqueueToast } from "@/lib/queue-cap";
import { useVaultIndex } from "@/lib/storage/vault-index";
import type { WorkCard } from "@/lib/types";

/** 无 Cookie / Cookie 失效的内联引导卡（AC3）：说明填法 + 直达设置锚点。 */
function CookieGuide({ expired }: { expired?: boolean }) {
  return (
    <Alert>
      <AlertTitle>{expired ? "X Cookie 已失效" : "还没填 X Cookie"}</AlertTitle>
      <AlertDescription className="space-y-2">
        {/* AlertDescription 本体是 <p>（ui/alert 惯例）：内部只放 phrasing 内容 */}
        <span className="block">
          浏览画师的 X 媒体时间线需要登录 Cookie（图片下载本身免登录）。
          在 x.com 登录后，从浏览器 DevTools → 网络 → 任意请求的 Cookie 头里复制
          <span className="text-fg"> auth_token </span>与<span className="text-fg"> ct0 </span>
          两段（整段头粘贴也行，会自动只留这两项），填进 设置 → 账号 的「X（Twitter）」框。
        </span>
        <Button className="mt-1" variant="secondary" asChild>
          <Link to="/settings" hash="accounts">
            去设置填 X Cookie
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function XPreviewPage() {
  const rawHandle = useParams<{ handle: string }>().handle ?? "";
  // 容错：路径里带 @ / 大小写不一（画师页关联存的规范形态不带 @）
  const handle = rawHandle.replace(/^@+/, "");
  const xCookie = useSettings((s) => s.xCookie);
  const settingsReady = useSettingsHydrated();
  const xAssociations = useSettings((s) => s.xAssociations);
  // 批量选择与入队（user.$id 同款三件套：useBatchSelection + filterBatchable + enqueueWorks）
  const sel = useBatchSelection();
  const vaultKeys = useVaultIndex((s) => s.keys);
  const queueItems = useQueue((s) => s.items);
  const queueKeys = useMemo(
    () => queueItems.filter((x) => x.status === "queued" || x.status === "running").map((x) => x.key),
    [queueItems],
  );

  const cookieReady = Boolean(sanitizeXCookie(xCookie));
  // 键含 credentialTag（#204 教训）：换号 / 换 Cookie 不命中旧缓存。写读同键，
  // staleTime 10 分钟、无自动轮询（R6）。
  const queryKey = useMemo(
    () => xMediaQueryKey(handle, credentialTag(sanitizeXCookie(xCookie))),
    [handle, xCookie],
  );

  const query = useInfiniteQuery({
    queryKey,
    enabled: settingsReady && cookieReady,
    initialPageParam: undefined as string | undefined,
    staleTime: X_MEDIA_STALE_MS,
    queryFn: async ({ pageParam }) => {
      const r = await fetchSource({
        data: { op: "xUserMedia", handle, cursor: pageParam, ...cookiesFromSettings("x") },
      });
      if (r.op !== "xUserMedia") throw new Error("返回异常");
      return r;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // 页间 id 去重（browse collectWorks 同口径）：游标翻页偶发重叠不重复出卡
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: WorkCard[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const work of page.items) {
        if (work.source !== "x") continue;
        if (seen.has(work.id)) continue;
        seen.add(work.id);
        out.push(work);
      }
    }
    return out;
  }, [query.data?.pages]);
  // user 每页都带回（x.ts），第一页足够；首屏加载中顶栏先画 @handle 占位
  const user = query.data?.pages[0]?.user;
  // 反查画师页链接：沿用 M5「仅忽略记录不算关联」判据（x-media.ts 集中实现）
  const linkedAuthorId = useMemo(
    () => findXLinkedAuthorId(xAssociations, { handle, restId: user?.restId }),
    [xAssociations, handle, user?.restId],
  );

  const errorMessage =
    query.error instanceof Error ? query.error.message : query.error ? "加载失败" : null;

  function enqueueSelected(kind: "vault" | "download") {
    const cards = items.filter((c) => sel.selected.has(workKeyOf(c)));
    const { batchable, skippedVault, skippedQueue } = filterBatchable(cards, {
      inVaultKeys: new Set(Object.keys(vaultKeys)),
      inQueueKeys: new Set(queueKeys),
    });
    const tally = enqueueWorks(batchable, kind);
    const skipped: string[] = [];
    if (skippedVault) skipped.push(`已在纸匣 ${skippedVault}`);
    if (skippedQueue) skipped.push(`队列中 ${skippedQueue}`);
    toast.success(formatBatchEnqueueToast(kind, tally, skipped));
    sel.exit();
  }

  // 水合前统一画骨架（browse 同款：持久化值水合会翻登录态 / 引导分支）
  if (!settingsReady) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <ArtworkGridSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4 md:gap-5">
        <ProfileAvatar src={user?.avatar ?? ""} name={user?.name ?? handle} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-display text-2xl leading-tight tracking-tight md:text-3xl">
              {user?.name || handle}
            </h1>
            <span className="text-sm text-muted">@{handle}</span>
          </div>
          <p className="max-w-lg text-xs text-muted">
            X 媒体时间线 · 只列 TA 自己发的图推（转发与纯文字不出现），挑中的经队列收入纸匣
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {linkedAuthorId ? (
              <Button size="sm" variant="outline" asChild>
                <Link to="/user/$id" params={{ id: linkedAuthorId }} resetScroll={false}>
                  <ArrowLeft className="size-4" />
                  回画师页
                </Link>
              </Button>
            ) : null}
            <Button size="sm" variant={sel.active ? "default" : "outline"} onClick={sel.toggleActive}>
              <Layers className="size-4" />
              {sel.active ? "退出批量" : "批量收藏"}
            </Button>
            {sel.active ? (
              <span className="text-xs tabular-nums text-subtle">
                单批上限 {BATCH_MAX} 张
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* 无 Cookie：明确引导而非静默空态（AC3）；查询保持 disabled 不打上游 */}
      {!cookieReady ? <CookieGuide /> : query.isLoading ? (
        <ArtworkGridSkeleton count={6} />
      ) : errorMessage ? (
        isXCookieGuideMessage(errorMessage) ? (
          <CookieGuide expired />
        ) : (
          <Alert variant="danger">
            <AlertTitle>暂时无法连接到 X。</AlertTitle>
            <AlertDescription className="space-y-2">
              <span className="block">{errorMessage}</span>
              <Button
                className="mt-1"
                variant="secondary"
                onClick={() => void query.refetch().catch(() => undefined)}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )
      ) : (
        <section className="space-y-3">
          <ArtworkGrid
            items={items}
            selection={sel.active ? { selected: sel.selected, onToggle: sel.toggle } : undefined}
            empty="这位画师在 X 上还没有可展示的图推。"
          />
          <InfiniteSentinel
            disabled={!query.hasNextPage || query.isFetchingNextPage}
            onVisible={() => void query.fetchNextPage()}
          />
        </section>
      )}

      {sel.active ? (
        <BatchToolbar
          selectedCount={sel.selected.size}
          total={items.length}
          onSelectAll={() => sel.selectAll(items.map(workKeyOf))}
          onClear={sel.clear}
          onEnqueue={enqueueSelected}
          onDone={sel.exit}
        />
      ) : null}
    </div>
  );
}
