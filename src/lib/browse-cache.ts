/**
 * 浏览列表的本地缓存。
 *
 * 作用：刷新先画出浏览器里上次的榜单 / 推荐 / 关注 / FANBOX，再后台问 Next。
 * 用法：hydrateBrowseCache(queryClient) 在创建 QueryClient 时同步调用。
 * 为什么：QueryClient 只活在内存。localStorage 同步读，首屏不等网络。
 *        存够一屏（约 50 张）；24 小时后丢掉。queryKey 区分账号。过期后才打 Next（Next 还有一层盘）。
 */
import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";

/**
 * v2：v1 的 queryKey 里是 Cookie 原文（SEC-04），升级为凭据指纹后直接弃用
 * 旧存储——读到旧键时顺手删掉，不把历史明文留在盘上。
 */
const STORAGE_KEY = "kami-browse-v2";
const LEGACY_STORAGE_KEY = "kami-browse-v1";
const MAX_AGE_MS = 24 * 60 * 60_000;
export const BROWSE_STALE_MS = 30 * 60_000;
/** 够铺一屏浏览页（50 张）。FANBOX 一页大约 10 条，所以不能只留 2 页。 */
const MAX_PAGES = 8;
const MIN_ITEMS = 50;
const MAX_QUERIES = 16;
const PREFIX = new Set(["home-pixiv", "home-booru", "home-fanbox"]);

function pageItemCount(page: unknown): number {
  if (page && typeof page === "object" && "items" in page && Array.isArray(page.items)) {
    return page.items.length;
  }
  return 1;
}

function trimPages(pages: unknown[], pageParams: unknown[] | undefined) {
  let items = 0;
  let n = 0;
  for (const page of pages) {
    n += 1;
    items += pageItemCount(page);
    if (n >= MAX_PAGES || items >= MIN_ITEMS) break;
  }
  return {
    pages: pages.slice(0, n),
    pageParams: (pageParams ?? pages.map((_, i) => i + 1)).slice(0, n),
  };
}

export function persistableQuery(query: { queryKey: readonly unknown[] }) {
  return typeof query.queryKey[0] === "string" && PREFIX.has(query.queryKey[0]);
}

export function trimDehydrated(state: DehydratedState, now = Date.now()): DehydratedState {
  const queries = state.queries
    .filter((q) => persistableQuery(q) && q.state.status === "success")
    .filter((q) => now - (q.state.dataUpdatedAt || 0) < MAX_AGE_MS)
    .slice(0, MAX_QUERIES)
    .map((q) => {
      const data = q.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
      if (!data?.pages) return q;
      const trimmed = trimPages(data.pages, data.pageParams);
      return {
        ...q,
        state: {
          ...q.state,
          data: {
            ...data,
            pages: trimmed.pages,
            pageParams: trimmed.pageParams,
          },
        },
      };
    });
  return { ...state, queries };
}

function readState(): DehydratedState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DehydratedState;
    if (!parsed || !Array.isArray(parsed.queries)) return null;
    const trimmed = trimDehydrated(parsed);
    return trimmed.queries.length ? trimmed : null;
  } catch {
    return null;
  }
}

function writeState(state: DehydratedState) {
  if (typeof localStorage === "undefined") return;
  const trimmed = trimDehydrated(state);
  if (trimmed.queries.length === 0) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* quota */
    }
  }
}

export function hydrateBrowseCache(client: QueryClient) {
  const state = readState();
  if (state) hydrate(client, state);
  const refresh = () => {
    const now = Date.now();
    for (const query of client.getQueryCache().getAll()) {
      if (!persistableQuery(query) || query.state.status !== "success") continue;
      // 只有挂了观察者（浏览页在屏上）的键才有 queryFn；hydrate 进来的其它键直接
      // fetch 会炸 "Missing queryFn"，未处理拒绝还会弹 Next 开发红屏。没挂载的
      // 键留给浏览页挂载时按 dataUpdatedAt 自己补刷。
      if (!query.options.queryFn) continue;
      if (now - query.state.dataUpdatedAt > BROWSE_STALE_MS) void query.fetch();
    }
  };
  if (typeof window === "undefined") {
    refresh();
    return;
  }
  window.setTimeout(refresh, 0);
}

export function subscribeBrowsePersist(client: QueryClient) {
  let timer = 0;
  const unsub = client.getQueryCache().subscribe(() => {
    if (typeof window === "undefined") return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (q: Query) => persistableQuery(q) && q.state.status === "success",
      });
      writeState(state);
    }, 700);
  });
  return () => {
    if (typeof window !== "undefined") window.clearTimeout(timer);
    unsub();
  };
}
