import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { QueueItem, Source } from "./types";
import type { SearchEngine } from "./reverse-search";
import { DEFAULT_SEARCH_ENGINE, isSearchEngine } from "./reverse-search";
import { saveSessions } from "./source";
import {
  type Account,
  cookiesOf,
  createAccount,
  migrateLegacySettings,
} from "./accounts";

type Tab = Source;

type SettingsState = {
  pixivCookie: string;
  fanboxCookie: string;
  safeMode: boolean;
  hideAi: boolean;
  downloadOriginal: boolean;
  tab: Tab;
  searchEngine: SearchEngine;
  recents: string[];
  browseQuery: string;
  accounts: Account[];
  activeAccountId: string | null;
  setPixivCookie: (v: string) => void;
  setFanboxCookie: (v: string) => void;
  setSafeMode: (v: boolean) => void;
  setHideAi: (v: boolean) => void;
  setDownloadOriginal: (v: boolean) => void;
  setTab: (v: Tab) => void;
  setSearchEngine: (v: SearchEngine) => void;
  addRecent: (v: string) => void;
  setBrowseQuery: (v: string) => void;
  addAccount: (name: string) => string;
  renameAccount: (id: string, name: string) => void;
  removeAccount: (id: string) => void;
  switchAccount: (id: string) => Promise<void>;
  syncSessions: () => Promise<void>;
};

function withActiveCookies(
  accounts: Account[],
  activeAccountId: string | null,
): Pick<SettingsState, "accounts" | "activeAccountId" | "pixivCookie" | "fanboxCookie"> {
  const cookies = cookiesOf(accounts, activeAccountId);
  return {
    accounts,
    activeAccountId,
    pixivCookie: cookies.pixivCookie,
    fanboxCookie: cookies.fanboxCookie,
  };
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      pixivCookie: "",
      fanboxCookie: "",
      safeMode: true,
      hideAi: false,
      downloadOriginal: true,
      tab: "pixiv",
      searchEngine: DEFAULT_SEARCH_ENGINE,
      recents: [],
      browseQuery: "",
      accounts: [],
      activeAccountId: null,
      setPixivCookie: (pixivCookie) =>
        set((s) => {
          if (!s.activeAccountId) {
            const acc = createAccount("账号 1", pixivCookie, s.fanboxCookie);
            return withActiveCookies([acc], acc.id);
          }
          const accounts = s.accounts.map((a) =>
            a.id === s.activeAccountId ? { ...a, pixivCookie } : a,
          );
          return withActiveCookies(accounts, s.activeAccountId);
        }),
      setFanboxCookie: (fanboxCookie) =>
        set((s) => {
          if (!s.activeAccountId) {
            const acc = createAccount("账号 1", s.pixivCookie, fanboxCookie);
            return withActiveCookies([acc], acc.id);
          }
          const accounts = s.accounts.map((a) =>
            a.id === s.activeAccountId ? { ...a, fanboxCookie } : a,
          );
          return withActiveCookies(accounts, s.activeAccountId);
        }),
      setSafeMode: (safeMode) => set({ safeMode }),
      setHideAi: (hideAi) => set({ hideAi }),
      setDownloadOriginal: (downloadOriginal) => set({ downloadOriginal }),
      setTab: (tab) => set({ tab }),
      setSearchEngine: (searchEngine) =>
        set({ searchEngine: isSearchEngine(searchEngine) ? searchEngine : DEFAULT_SEARCH_ENGINE }),
      addRecent: (v) =>
        set((s) => ({
          recents: [v, ...s.recents.filter((x) => x !== v)].slice(0, 8),
        })),
      setBrowseQuery: (browseQuery) => set({ browseQuery }),
      addAccount: (name) => {
        const acc = createAccount(name);
        set((s) => withActiveCookies([...s.accounts, acc].slice(0, 8), acc.id));
        return acc.id;
      },
      renameAccount: (id, name) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === id ? { ...a, name: name.trim() || a.name } : a,
          ),
        })),
      removeAccount: (id) => {
        set((s) => {
          const accounts = s.accounts.filter((a) => a.id !== id);
          const activeAccountId =
            s.activeAccountId === id ? (accounts[0]?.id ?? null) : s.activeAccountId;
          return withActiveCookies(accounts, activeAccountId);
        });
        void get().syncSessions();
      },
      switchAccount: async (id) => {
        const s = get();
        if (!s.accounts.some((a) => a.id === id)) return;
        set(withActiveCookies(s.accounts, id));
        await get().syncSessions();
      },
      syncSessions: async () => {
        const { pixivCookie, fanboxCookie } = get();
        await saveSessions({
          data: { pixiv: pixivCookie, fanbox: fanboxCookie },
        });
      },
    }),
    {
      name: "kami-settings",
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const legacy = migrateLegacySettings({
          pixivCookie: typeof p.pixivCookie === "string" ? p.pixivCookie : "",
          fanboxCookie: typeof p.fanboxCookie === "string" ? p.fanboxCookie : "",
          accounts: Array.isArray(p.accounts) ? (p.accounts as Account[]) : undefined,
          activeAccountId: typeof p.activeAccountId === "string" ? p.activeAccountId : null,
        });
        const cookies = cookiesOf(legacy.accounts, legacy.activeAccountId);
        const searchEngine = isSearchEngine(String(p.searchEngine))
          ? (p.searchEngine as SearchEngine)
          : DEFAULT_SEARCH_ENGINE;
        const hideAi = p.hideAi === true;
        if (version >= 2 && legacy.accounts.length) {
          return { ...p, ...legacy, ...cookies, searchEngine, hideAi };
        }
        return { ...p, ...legacy, ...cookies, searchEngine, hideAi };
      },
      partialize: (s) => ({
        pixivCookie: s.pixivCookie,
        fanboxCookie: s.fanboxCookie,
        safeMode: s.safeMode,
        hideAi: s.hideAi,
        downloadOriginal: s.downloadOriginal,
        tab: s.tab,
        searchEngine: s.searchEngine,
        recents: s.recents,
        accounts: s.accounts,
        activeAccountId: s.activeAccountId,
      }),
    },
  ),
);

export function cookiesFromSettings(): {
  pixivCookie?: string;
  fanboxCookie?: string;
  safeMode: boolean;
  hideAi: boolean;
} {
  const s = useSettings.getState();
  return {
    pixivCookie: s.pixivCookie || undefined,
    fanboxCookie: s.fanboxCookie || undefined,
    safeMode: s.safeMode,
    hideAi: s.hideAi,
  };
}

type QueueState = {
  items: QueueItem[];
  enqueue: (item: Omit<QueueItem, "status" | "progress" | "total" | "addedAt" | "error">) => void;
  patch: (key: string, patch: Partial<QueueItem>) => void;
  remove: (key: string) => void;
  clearDone: () => void;
  clearAll: () => void;
};

export const useQueue = create<QueueState>()(
  persist(
    (set) => ({
      items: [],
      enqueue: (item) =>
        set((s) => {
          if (s.items.some((x) => x.key === item.key && x.status !== "done")) {
            return s;
          }
          const next: QueueItem = {
            ...item,
            status: "queued",
            progress: 0,
            total: 1,
            addedAt: Date.now(),
          };
          return { items: [next, ...s.items.filter((x) => x.key !== item.key)].slice(0, 80) };
        }),
      patch: (key, patch) =>
        set((s) => ({
          items: s.items.map((x) => (x.key === key ? { ...x, ...patch } : x)),
        })),
      remove: (key) => set((s) => ({ items: s.items.filter((x) => x.key !== key) })),
      clearDone: () => set((s) => ({ items: s.items.filter((x) => x.status !== "done") })),
      clearAll: () => set({ items: [] }),
    }),
    { name: "kami-queue" },
  ),
);
