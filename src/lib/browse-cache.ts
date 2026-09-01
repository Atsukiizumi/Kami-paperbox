/**
 * 浏览列表的本地缓存。
 *
 * 作用：刷新页面先画出上次的榜单 / 推荐 / 图站，超过 30 分钟再后台更新。
 * 用法：hydrateBrowseCache(queryClient) 在创建 QueryClient 时同步调用。
 * 为什么：QueryClient 只活在内存。localStorage 能同步读，首屏不用等 IndexedDB。
 *        只存前两页；24 小时后丢掉。Cookie 已在设置里，queryKey 用来区分账号。
 */
import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";

const STORAGE_KEY = "kami-browse-v1";
const MAX_AGE_MS = 24 * 60 * 60_000;
export const BROWSE_STALE_MS = 30 * 60_000;
const MAX_PAGES = 2;
const MAX_QUERIES = 12;
const PREFIX = new Set(["home-pixiv", "home-booru", "home-fanbox"]);

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
      return {
        ...q,
        state: {
          ...q.state,
          data: {
            ...data,
            pages: data.pages.slice(0, MAX_PAGES),
            pageParams: data.pageParams?.slice(0, MAX_PAGES) ?? data.pages.slice(0, MAX_PAGES).map((_, i) => i + 1),
          },
        },
      };
    });
  return { ...state, queries };
}

function readState(): DehydratedState | null {
  if (typeof localStorage === "undefined") return null;
  try {
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
  const now = Date.now();
  for (const query of client.getQueryCache().getAll()) {
    if (!persistableQuery(query) || query.state.status !== "success") continue;
    if (now - query.state.dataUpdatedAt > BROWSE_STALE_MS) void query.fetch();
  }
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
