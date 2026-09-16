/**
 * 案头去浏览主纸。
 *
 * 作用：当前站默认流 8 张封面铺满纸面，标题压在下面；整张字区进 /browse，封面进作品。
 * 用法：DeskPage 主格挂 <DeskBrowseSheet className={…} />。
 * 为什么：纯字大卡太空；推荐/最新不跟今日报纸的日榜抢同一排。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { ProxiedImg } from "@/components/proxied-img";
import { BROWSE_STALE_MS } from "@/lib/browse-cache";
import { DESK_PREVIEW_LIMIT, previewItems } from "@/lib/desk-preview";
import { Link } from "@/lib/kami-link";
import { isBooru, siteLabel } from "@/lib/sites";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { fanboxSessionFrom, isPixivLoggedInSession } from "@/lib/sync/browser-login";
import { credentialTag } from "@/lib/sync/cred-tag";
import { cn } from "@/lib/utils";

export function DeskBrowseSheet({ className }: { className?: string }) {
  const tab = useSettings((s) => s.tab);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const hydrated = useSettingsHydrated();
  const pixivLoggedIn =
    isPixivLoggedInSession(pixivCookie) ||
    Boolean(accounts.find((a) => a.id === activeAccountId)?.pixivProfile?.id);
  const pixivOp = pixivLoggedIn ? "recommend" : "ranking";

  const query = useQuery({
    queryKey: [
      "desk-preview",
      tab,
      pixivOp,
      Boolean(fanboxCookie),
      safeMode,
      hideAi,
      credentialTag(tab === "fanbox" ? fanboxCookie : pixivCookie),
    ],
    enabled: hydrated,
    staleTime: BROWSE_STALE_MS,
    queryFn: async () => {
      const creds = cookiesFromSettings();
      if (tab === "pixiv") {
        if (pixivLoggedIn) return fetchSource({ data: { op: "pixivRecommend", ...creds } });
        return fetchSource({ data: { op: "pixivRanking", mode: "daily", page: 1, ...creds } });
      }
      if (tab === "fanbox") {
        if (fanboxCookie) return fetchSource({ data: { op: "fanboxHome", ...creds } });
        return fetchSource({ data: { op: "fanboxCreator", id: "official", ...creds } });
      }
      if (isBooru(tab)) {
        return fetchSource({ data: { op: "booruList", site: tab, feed: "recent", page: 1, ...creds } });
      }
      throw new Error("不应发生");
    },
  });

  const items = previewItems(query.data);
  const pending = query.isPending && items.length === 0;

  return (
    <section
      className={cn(
        "kami-card-folded relative overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-paper-1)]",
        className,
      )}
    >
      <div className="grid grid-cols-4 gap-1 p-1.5">
        {pending
          ? Array.from({ length: DESK_PREVIEW_LIMIT }, (_, i) => (
              <div key={i} className="aspect-[3/4] rounded-md bg-elevated" />
            ))
          : items.map((card) => (
              <Link
                key={`${card.source}:${card.id}`}
                to="/work/$source/$id"
                params={{ source: card.source, id: card.id }}
                className="relative block aspect-[3/4] overflow-hidden rounded-md bg-elevated"
              >
                <ProxiedImg src={card.thumb} alt="" className="h-full w-full object-cover" />
              </Link>
            ))}
      </div>
      <div className="flex items-end justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-xs tracking-wide text-subtle">当前 · {siteLabel(tab)}</p>
          <Link
            to="/browse"
            prefetch={false}
            className="mt-1 block font-display text-3xl tracking-tight md:text-4xl"
          >
            去浏览
          </Link>
          <p className="mt-1 text-sm text-muted">日榜、关注、推荐都在那边</p>
        </div>
      </div>
    </section>
  );
}
