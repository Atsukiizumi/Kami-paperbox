/**
 * 客户端状态。
 *
 * 作用：账号 Cookie、主题、安全模式、路径规则、浏览 Tab、下载队列。
 * 用法：组件里 useSettings() / useQueue()；服务端函数里用 cookiesFromSettings()
 *      （读 persist 水合后的当前账号，FANBOX 会回退到 Pixiv 会话）。
 * 为什么：设置是小 JSON，localStorage 够用。队列只留 80 条状态，原图在纸匣 IDB，
 *        不要把 Blob 塞进 zustand。
 */
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
import { fanboxSessionFrom, sanitizePixivCookie } from "./browser-login";
import type { SiteProfile } from "./site-identity";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_THEME,
  SETTINGS_STORAGE_KEY,
  type Appearance,
  type ThemeId,
  parseAppearance,
  parseThemeId,
} from "./theme";
import {
  DEFAULT_PATH_PRESET,
  DEFAULT_PATH_TEMPLATE,
  type PathPreset,
  parsePathPreset,
  templateForPreset,
} from "./download-path";

type Tab = Source;

type SettingsState = {
  pixivCookie: string;
  fanboxCookie: string;
  safeMode: boolean;
  hideAi: boolean;
  downloadOriginal: boolean;
  vaultMirrorFolder: boolean;
  downloadToFolder: boolean;
  pathPreset: PathPreset;
  pathTemplate: string;
  folderLabel: string;
  tab: Tab;
  searchEngine: SearchEngine;
  recents: string[];
  browseQuery: string;
  accounts: Account[];
  activeAccountId: string | null;
  theme: ThemeId;
  appearance: Appearance;
  setPixivCookie: (v: string) => void;
  setFanboxCookie: (v: string) => void;
  setSafeMode: (v: boolean) => void;
  setHideAi: (v: boolean) => void;
  setDownloadOriginal: (v: boolean) => void;
  setVaultMirrorFolder: (v: boolean) => void;
  setDownloadToFolder: (v: boolean) => void;
  setPathPreset: (v: PathPreset) => void;
  setPathTemplate: (v: string) => void;
  setFolderLabel: (v: string) => void;
  setTab: (v: Tab) => void;
  setSearchEngine: (v: SearchEngine) => void;
  addRecent: (v: string) => void;
  setBrowseQuery: (v: string) => void;
  setTheme: (v: ThemeId) => void;
  setAppearance: (v: Appearance) => void;
  addAccount: (name: string) => string;
  renameAccount: (id: string, name: string) => void;
  removeAccount: (id: string) => void;
  switchAccount: (id: string) => Promise<void>;
  syncSessions: () => Promise<void>;
  applyProfiles: (profiles: { pixiv?: SiteProfile | null; fanbox?: SiteProfile | null }) => void;
  refreshIdentities: () => Promise<void>;
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
      vaultMirrorFolder: true,
      downloadToFolder: true,
      pathPreset: DEFAULT_PATH_PRESET,
      pathTemplate: DEFAULT_PATH_TEMPLATE,
      folderLabel: "",
      tab: "pixiv",
      searchEngine: DEFAULT_SEARCH_ENGINE,
      recents: [],
      browseQuery: "",
      accounts: [],
      activeAccountId: null,
      theme: DEFAULT_THEME,
      appearance: DEFAULT_APPEARANCE,
      setPixivCookie: (pixivCookie) =>
        set((s) => {
          if (!s.activeAccountId) {
            const acc = createAccount("账号 1", pixivCookie, s.fanboxCookie);
            return withActiveCookies([acc], acc.id);
          }
          const accounts = s.accounts.map((a) =>
            a.id === s.activeAccountId ? { ...a, pixivCookie, pixivProfile: null } : a,
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
            a.id === s.activeAccountId ? { ...a, fanboxCookie, fanboxProfile: null } : a,
          );
          return withActiveCookies(accounts, s.activeAccountId);
        }),
      setSafeMode: (safeMode) => set({ safeMode }),
      setHideAi: (hideAi) => set({ hideAi }),
      setDownloadOriginal: (downloadOriginal) => set({ downloadOriginal }),
      setVaultMirrorFolder: (vaultMirrorFolder) => set({ vaultMirrorFolder }),
      setDownloadToFolder: (downloadToFolder) => set({ downloadToFolder }),
      setPathPreset: (preset) => {
        const pathPreset = parsePathPreset(preset);
        set({
          pathPreset,
          pathTemplate: templateForPreset(pathPreset, get().pathTemplate),
        });
      },
      setPathTemplate: (pathTemplate) =>
        set({
          pathTemplate,
          pathPreset: "custom",
        }),
      setFolderLabel: (folderLabel) => set({ folderLabel }),
      setTab: (tab) => set({ tab }),
      setSearchEngine: (searchEngine) =>
        set({ searchEngine: isSearchEngine(searchEngine) ? searchEngine : DEFAULT_SEARCH_ENGINE }),
      addRecent: (v) =>
        set((s) => ({
          recents: [v, ...s.recents.filter((x) => x !== v)].slice(0, 8),
        })),
      setBrowseQuery: (browseQuery) => set({ browseQuery }),
      setTheme: (theme) => set({ theme: parseThemeId(theme) }),
      setAppearance: (appearance) => set({ appearance: parseAppearance(appearance) }),
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
      applyProfiles: (profiles) => {
        set((s) => {
          if (!s.activeAccountId) return s;
          const accounts = s.accounts.map((a) =>
            a.id === s.activeAccountId
              ? {
                  ...a,
                  pixivProfile: profiles.pixiv !== undefined ? profiles.pixiv : a.pixivProfile,
                  fanboxProfile: profiles.fanbox !== undefined ? profiles.fanbox : a.fanboxProfile,
                }
              : a,
          );
          return { accounts };
        });
      },
      refreshIdentities: async () => {
        const { pixivCookie, fanboxCookie } = get();
        if (!pixivCookie && !fanboxCookie) {
          get().applyProfiles({ pixiv: null, fanbox: null });
          return;
        }
        const res = await fetch("/api/whoami", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pixiv: pixivCookie, fanbox: fanboxCookie }),
        });
        const data = (await res.json()) as {
          pixiv?: SiteProfile | null;
          fanbox?: SiteProfile | null;
        };
        get().applyProfiles({
          pixiv: pixivCookie ? (data.pixiv ?? null) : null,
          fanbox: fanboxCookie ? (data.fanbox ?? null) : null,
        });
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 7,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const legacy = migrateLegacySettings({
          pixivCookie: typeof p.pixivCookie === "string" ? p.pixivCookie : "",
          fanboxCookie: typeof p.fanboxCookie === "string" ? p.fanboxCookie : "",
          accounts: Array.isArray(p.accounts) ? (p.accounts as Account[]) : undefined,
          activeAccountId: typeof p.activeAccountId === "string" ? p.activeAccountId : null,
        });
        legacy.accounts = legacy.accounts.map((a) => {
          const pixivCookie = sanitizePixivCookie(a.pixivCookie);
          const fanboxCookie = fanboxSessionFrom(a.fanboxCookie, pixivCookie);
          return {
            ...a,
            pixivCookie,
            fanboxCookie,
            pixivProfile: pixivCookie ? a.pixivProfile : null,
            fanboxProfile: fanboxCookie ? a.fanboxProfile : null,
          };
        });
        const cookies = cookiesOf(legacy.accounts, legacy.activeAccountId);
        const searchEngine = isSearchEngine(String(p.searchEngine))
          ? (p.searchEngine as SearchEngine)
          : DEFAULT_SEARCH_ENGINE;
        const hideAi = p.hideAi === true;
        const theme = parseThemeId(p.theme);
        const appearance = parseAppearance(p.appearance);
        const pathPreset = parsePathPreset(p.pathPreset);
        const pathTemplate =
          typeof p.pathTemplate === "string" && p.pathTemplate.trim()
            ? p.pathTemplate
            : templateForPreset(pathPreset);
        const extra = {
          vaultMirrorFolder: p.vaultMirrorFolder !== false,
          downloadToFolder: p.downloadToFolder !== false,
          pathPreset,
          pathTemplate,
          folderLabel: typeof p.folderLabel === "string" ? p.folderLabel : "",
        };
        if (version >= 2 && legacy.accounts.length) {
          return { ...p, ...legacy, ...cookies, searchEngine, hideAi, theme, appearance, ...extra };
        }
        return { ...p, ...legacy, ...cookies, searchEngine, hideAi, theme, appearance, ...extra };
      },
      partialize: (s) => ({
        pixivCookie: s.pixivCookie,
        fanboxCookie: s.fanboxCookie,
        safeMode: s.safeMode,
        hideAi: s.hideAi,
        downloadOriginal: s.downloadOriginal,
        vaultMirrorFolder: s.vaultMirrorFolder,
        downloadToFolder: s.downloadToFolder,
        pathPreset: s.pathPreset,
        pathTemplate: s.pathTemplate,
        folderLabel: s.folderLabel,
        tab: s.tab,
        searchEngine: s.searchEngine,
        recents: s.recents,
        accounts: s.accounts,
        activeAccountId: s.activeAccountId,
        theme: s.theme,
        appearance: s.appearance,
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
  const pixiv = sanitizePixivCookie(s.pixivCookie);
  const fanbox = fanboxSessionFrom(s.fanboxCookie, pixiv);
  return {
    pixivCookie: pixiv || undefined,
    fanboxCookie: fanbox || undefined,
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
