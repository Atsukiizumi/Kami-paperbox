"use client";

/**
 * 浏览卡片交互接线（悬停预览 / 右键菜单 / 多 P 翻页 / 收纸匣·下载·红心 / 搜标签）。
 *
 * 作用：把 ArtworkCard 的交互状态、定时器和副作用收敛成一个 hook，卡片本体只剩
 *      布局与数据接线。
 * 用法：ArtworkCard 里 `useCardInteractions(work, pages, mediaRef)`，返回值逐个
 *      接回原 JSX；事件签名与拆分前完全一致，不要在这里改交互。
 * 为什么：这些域互相咬合（预览要看菜单开合、翻页滚轮只在预览开着时挂、
 *        取消预取要连预览一起收），拆成多个 hook 反而要互相传参；单 hook
 *        保证是零行为变化的搬运。
 */
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useNavigate } from "@/lib/kami-link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CardMenuPos } from "@/components/card-menu";
import { canHoverPreview } from "@/components/hover-preview";
import { wheelDir, wrapPage } from "@/lib/page-flip";
import type { WorkCard } from "@/lib/types";
import { enqueueWork } from "@/lib/queue-runner";
import { flyPaperToQueue, rectFromEvent } from "@/lib/paper-fly";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { mutateSource } from "@/lib/source";
import { patchCachedWork } from "@/lib/work-cache";
import { prefetchWork } from "@/lib/work-detail";
import { canonicalTag } from "@/lib/site-tags";
import { warmMedia } from "@/components/proxied-img";
import { upgradeThumbUrl } from "@/lib/thumb-url";

/** 悬停预览要等够久，才能先点到封面上的红心、纸匣和队列。 */
const PREVIEW_HOVER_MS = 520;

export function useCardInteractions(
  work: WorkCard,
  pages: string[],
  mediaRef: RefObject<HTMLDivElement | null>,
) {
  const hasMedia = Boolean(work.thumb);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const [liking, setLiking] = useState(false);
  const [heartPop, setHeartPop] = useState(false);
  const [menu, setMenu] = useState<CardMenuPos | null>(null);
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const [pageI, setPageI] = useState(0);
  const hoverTimer = useRef(0);
  const previewTimer = useRef(0);
  const cover = pages[Math.min(pageI, Math.max(0, pages.length - 1))] ?? work.thumb;
  const liked = Boolean(work.liked || work.bookmarked);

  function armPrefetch() {
    window.clearTimeout(hoverTimer.current);
    if (work.thumb) warmMedia(upgradeThumbUrl(cover || work.thumb));
    hoverTimer.current = window.setTimeout(() => {
      prefetchWork(queryClient, work.source, work.id);
    }, 160);
  }

  function showPreview() {
    if (!hasMedia || work.restricted || menu || !canHoverPreview()) return;
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const box = mediaRef.current?.getBoundingClientRect();
      if (box) setPreview(box);
    }, PREVIEW_HOVER_MS);
  }

  function hidePreview() {
    window.clearTimeout(previewTimer.current);
    setPreview(null);
  }

  function cancelPrefetch() {
    window.clearTimeout(hoverTimer.current);
    hidePreview();
  }

  async function saveCard(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    hidePreview();
    if (work.restricted) return;
    enqueueWork(work, "vault");
    flyPaperToQueue(e ? rectFromEvent(e.currentTarget) : mediaRef.current?.getBoundingClientRect());
    toast.success("已加入队列：收入纸匣");
  }

  function queueCard(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    hidePreview();
    if (work.restricted) return;
    enqueueWork(work, "download");
    flyPaperToQueue(e ? rectFromEvent(e.currentTarget) : mediaRef.current?.getBoundingClientRect());
    toast.success("已加入队列：下载");
  }

  async function likeCard(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (work.source !== "pixiv" || liking) return;
    if (liked) {
      toast.success("已经点过红心");
      return;
    }
    if (!pixivCookie) {
      toast.error("先在设置里添加 Pixiv 账号");
      return;
    }
    setLiking(true);
    setHeartPop(true);
    patchCachedWork(queryClient, work.source, work.id, { liked: true, bookmarked: true });
    try {
      await mutateSource({
        data: { op: "pixivLike", id: work.id, tags: work.tags, ...cookiesFromSettings("pixiv") },
      });
    } catch (err) {
      patchCachedWork(queryClient, work.source, work.id, { liked: false, bookmarked: false });
      setHeartPop(false);
      toast.error(err instanceof Error ? err.message : "红心失败");
    } finally {
      setLiking(false);
    }
  }

  function searchTag(tag: string) {
    const word = canonicalTag(work.source, tag) || tag.trim();
    if (!word) return;
    setTab(work.source);
    setBrowseQuery(word, true);
    void navigate({ to: "/browse" });
  }

  useEffect(() => {
    if (!preview) return;
    const hide = () => {
      window.clearTimeout(previewTimer.current);
      setPreview(null);
    };
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [preview]);

  // 滚轮切页（多 P 预览）：浮层打开时，滚轮落在卡片媒体区（浮层本身
  // pointer-events-none，事件穿透到卡片）即翻页；浮层关着时不挂监听，
  // 网格滚动不受影响。React 的 onWheel 是 passive，必须原生挂载才能
  // preventDefault 拦住页面滚动。
  const lastFlipAt = useRef(0);
  useEffect(() => {
    const el = mediaRef.current;
    if (!preview || pages.length <= 1 || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      const dir = wheelDir(e.deltaY, lastFlipAt.current, now);
      if (dir === 0) return;
      lastFlipAt.current = now;
      setPageI((i) => wrapPage(i, dir, pages.length));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // mediaRef 是 useRef 产物、身份恒定，列进依赖只为过 exhaustive-deps，不改变重挂时机。
  }, [preview, pages.length, mediaRef]);

  return {
    cover,
    liked,
    pageI,
    setPageI,
    preview,
    menu,
    setMenu,
    liking,
    heartPop,
    armPrefetch,
    cancelPrefetch,
    showPreview,
    hidePreview,
    saveCard,
    queueCard,
    likeCard,
    searchTag,
  };
}
