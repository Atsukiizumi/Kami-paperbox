/**
 * 把社交状态写回 React Query 缓存。
 *
 * 作用：浏览卡片点红心后，详情页和列表里的 liked 一起变。
 * 用法：patchCachedWork(queryClient, "pixiv", id, { liked: true })。
 * 为什么：卡片自己 useState 一卸载就丢；queryKey 前缀匹配能覆盖分页和账号切换。
 */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { FetchOk, Source, WorkCard, WorkDetail } from "./types";

function patchItems(items: WorkCard[], source: Source, id: string, patch: Partial<WorkCard>): WorkCard[] {
  let changed = false;
  const next = items.map((work) => {
    if (work.source !== source || work.id !== id) return work;
    changed = true;
    return { ...work, ...patch };
  });
  return changed ? next : items;
}

function patchFetch(old: FetchOk | undefined, source: Source, id: string, patch: Partial<WorkCard>): FetchOk | undefined {
  if (!old || !("items" in old)) return old;
  const items = patchItems(old.items, source, id, patch);
  return items === old.items ? old : { ...old, items };
}

export function patchCachedWork(
  queryClient: QueryClient,
  source: Source,
  id: string,
  patch: Partial<WorkCard> & Partial<WorkDetail>,
) {
  const listKeys = [["home-pixiv"], ["home-booru"], ["related"], ["user"]];
  for (const queryKey of listKeys) {
    queryClient.setQueriesData<FetchOk>({ queryKey }, (old) => patchFetch(old, source, id, patch));
  }
  const pageKeys = [["home-fanbox"], ["creator"]];
  for (const queryKey of pageKeys) {
    queryClient.setQueriesData<InfiniteData<FetchOk>>({ queryKey }, (old) => {
      if (!old?.pages) return old;
      let changed = false;
      const pages = old.pages.map((page) => {
        const next = patchFetch(page, source, id, patch);
        if (next !== page) changed = true;
        return next ?? page;
      });
      return changed ? { ...old, pages } : old;
    });
  }
  queryClient.setQueriesData<WorkDetail>({ queryKey: ["work", source, id] }, (old) =>
    old ? { ...old, ...patch } : old,
  );
}
