/**
 * 客户端状态。
 *
 * 作用：账号 Cookie、主题、安全模式、路径规则、浏览 Tab、各站快捷标签、下载队列。
 * 用法：组件里 useSettings() / useQueue()；服务端函数里用 cookiesFromSettings()
 *      （读 persist 水合后的当前账号，FANBOX 会回退到 Pixiv 会话）。
 * 为什么：设置是小 JSON，localStorage 够用。队列只留 80 条状态，原图在纸匣 IDB，
 *        不要把 Blob 塞进 zustand。
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { clampQueueConcurrency } from "./queue-retry.ts";
import { persist } from "zustand/middleware";
import type { QueueItem, Source } from "./types.ts";
import type { SearchEngine } from "./reverse-search.ts";
import { DEFAULT_SEARCH_ENGINE, isSearchEngine } from "./reverse-search.ts";
import { saveSessions } from "./source.ts";
import {
  type Account,
  cookiesOf,
  createAccount,
  migrateLegacySettings,
} from "./accounts.ts";
import { fanboxSessionFrom, sanitizePixivCookie } from "./browser-login.ts";
import type { SiteProfile } from "./site-identity.ts";
import { parseSmartFolders, type SmartFolder, type VaultQuery } from "./vault-query.ts";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_THEME,
  SETTINGS_STORAGE_KEY,
  type Appearance,
  type ThemeId,
  parseAppearance,
  parseThemeId,
} from "./theme.ts";
import {
  DEFAULT_PATH_PRESET,
  DEFAULT_PATH_TEMPLATE,
  type PathPreset,
  parsePathPreset,
  templateForPreset,
} from "./download-path.ts";
import {
  emptySavedTags,
  parseSavedTags,
  toggleSavedTag as toggleSavedTagList,
} from "./site-tags.ts";

type PersistApi = {
  hasHydrated?: () => boolean;
  onFinishHydration?: (cb: () => void) => () => void;
};

/** Zustand persist 在 SSR 上可能没有 `.persist`。等浏览器水合后再跑。 */
export function onPersisted(store: { persist?: PersistApi }, fn: () => void): () => void {
  const api = store.persist;
  if (!api?.hasHydrated) {
    fn();
    return () => undefined;
  }
  if (api.hasHydrated()) {
    fn();
    return () => undefined;
  }
  return api.onFinishHydration?.(fn) ?? (() => undefined);
}

type Tab = Source;

type SettingsState = {
  pixivCookie: string;
  fanboxCookie: string;
  danbooruLogin: string;
  danbooruApiKey: string;
  safeMode: boolean;
  hideAi: boolean;
  downloadOriginal: boolean;
  queueConcurrency: number;
  vaultMirrorFolder: boolean;
  downloadToFolder: boolean;
  pathPreset: PathPreset;
  pathTemplate: string;
  folderLabel: string;
  tab: Tab;
  searchEngine: SearchEngine;
  saucenaoApiKey: string;
  recents: string[];
  browseQuery: string;
  browseExact: boolean;
  savedTags: Record<Source, string[]>;
  smartFolders: SmartFolder[];
  accounts: Account[];
  activeAccountId: string | null;
  theme: ThemeId;
  appearance: Appearance;
  onboarded: boolean;
  addSmartFolder: (name: string, query: VaultQuery) => void;
  removeSmartFolder: (id: string) => void;
  setPixivCookie: (v: string) => void;
  setFanboxCookie: (v: string) => void;
  setDanbooruLogin: (v: string) => void;
  setDanbooruApiKey: (v: string) => void;
  setSafeMode: (v: boolean) => void;
  setHideAi: (v: boolean) => void;
  setDownloadOriginal: (v: boolean) => void;
  setQueueConcurrency: (v: number) => void;
  setVaultMirrorFolder: (v: boolean) => void;
  setDownloadToFolder: (v: boolean) => void;
  setPathPreset: (v: PathPreset) => void;
  setPathTemplate: (v: string) => void;
  setFolderLabel: (v: string) => void;
  setTab: (v: Tab) => void;
  setSearchEngine: (v: SearchEngine) => void;
  setSaucenaoApiKey: (v: string) => void;
  addRecent: (v: string) => void;
  setBrowseQuery: (v: string, exact?: boolean) => void;
  toggleSavedTag: (source: Source, tag: string) => void;
  setTheme: (v: ThemeId) => void;
  setAppearance: (v: Appearance) => void;
  setOnboarded: (v: boolean) => void;
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
      danbooruLogin: "",
      danbooruApiKey: "",
      safeMode: true,
      hideAi: false,
      downloadOriginal: true,
      queueConcurrency: 1,
      vaultMirrorFolder: true,
      downloadToFolder: true,
      pathPreset: DEFAULT_PATH_PRESET,
      pathTemplate: DEFAULT_PATH_TEMPLATE,
      folderLabel: "",
      tab: "pixiv",
      searchEngine: DEFAULT_SEARCH_ENGINE,
      saucenaoApiKey: "",
      recents: [],
      browseQuery: "",
      browseExact: false,
      savedTags: emptySavedTags(),
      smartFolders: [],
      accounts: [],
      activeAccountId: null,
      theme: DEFAULT_THEME,
      appearance: DEFAULT_APPEARANCE,
      onboarded: false,
      setPixivCookie: (pixivCookie) => {
        set((s) => {
          if (!s.activeAccountId) {
            const acc = createAccount("账号 1", pixivCookie, s.fanboxCookie);
            return withActiveCookies([acc], acc.id);
          }
          const accounts = s.accounts.map((a) =>
            a.id === s.activeAccountId ? { ...a, pixivCookie, pixivProfile: null } : a,
          );
          return withActiveCookies(accounts, s.activeAccountId);
        });
        void get().syncSessions();
      },
      setFanboxCookie: (fanboxCookie) => {
        set((s) => {
          if (!s.activeAccountId) {
            const acc = createAccount("账号 1", s.pixivCookie, fanboxCookie);
            return withActiveCookies([acc], acc.id);
          }
          const accounts = s.accounts.map((a) =>
            a.id === s.activeAccountId ? { ...a, fanboxCookie, fanboxProfile: null } : a,
          );
          return withActiveCookies(accounts, s.activeAccountId);
        });
        void get().syncSessions();
      },
      setDanbooruLogin: (danbooruLogin) => set({ danbooruLogin: danbooruLogin.trim().slice(0, 120) }),
      setDanbooruApiKey: (danbooruApiKey) => set({ danbooruApiKey: danbooruApiKey.trim().slice(0, 200) }),
      setSafeMode: (safeMode) => set({ safeMode }),
      setHideAi: (hideAi) => set({ hideAi }),
      setDownloadOriginal: (downloadOriginal) => set({ downloadOriginal }),
      setQueueConcurrency: (queueConcurrency) => set({ queueConcurrency }),
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
      setSaucenaoApiKey: (saucenaoApiKey) => set({ saucenaoApiKey: saucenaoApiKey.trim().slice(0, 80) }),
      addRecent: (v) =>
        set((s) => ({
          recents: [v, ...s.recents.filter((x) => x !== v)].slice(0, 8),
        })),
      setBrowseQuery: (browseQuery, exact = false) =>
        set({ browseQuery, browseExact: Boolean(exact) }),
      toggleSavedTag: (source, tag) =>
        set((s) => ({
          savedTags: {
            ...s.savedTags,
            [source]: toggleSavedTagList(s.savedTags[source] ?? [], source, tag),
          },
        })),
      addSmartFolder: (name, query) =>
        set((s) => {
          const trimmed = name.trim().slice(0, 40);
          if (!trimmed) return s;
          // 复用备份解析做白名单清洗，保证持久化形状与同步段一致
          const [folder] = parseSmartFolders([{ id: crypto.randomUUID(), name: trimmed, query }]);
          if (!folder) return s;
          if (s.smartFolders.some((f) => f.name === folder.name && JSON.stringify(f.query) === JSON.stringify(folder.query))) return s;
          return { smartFolders: [...s.smartFolders, folder].slice(0, 50) };
        }),
      removeSmartFolder: (id) => set((s) => ({ smartFolders: s.smartFolders.filter((f) => f.id !== id) })),
      setTheme: (theme) => set({ theme: parseThemeId(theme) }),
      setAppearance: (appearance) => set({ appearance: parseAppearance(appearance) }),
      setOnboarded: (onboarded) => set({ onboarded }),
      addAccount: (name) => {
        const current = get();
        if (current.accounts.length >= 8) return current.activeAccountId ?? "";
        const acc = createAccount(name);
        set(withActiveCookies([...current.accounts, acc], acc.id));
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
        const { pixivCookie, fanboxCookie, danbooruLogin, danbooruApiKey } = get();
        const pixiv = sanitizePixivCookie(pixivCookie);
        const fanbox = fanboxSessionFrom(fanboxCookie, pixiv);
        await saveSessions({
          data: { pixiv, fanbox, danbooruLogin, danbooruApiKey },
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
        try {
          const res = await fetch("/api/whoami", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pixiv: pixivCookie, fanbox: fanboxCookie }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            pixiv?: SiteProfile | null;
            fanbox?: SiteProfile | null;
          };
          get().applyProfiles({
            pixiv: pixivCookie ? (data.pixiv ?? null) : null,
            fanbox: fanboxCookie ? (data.fanbox ?? null) : null,
          });
        } catch {
          /* keep whatever profile we already have */
        }
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 10,
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
          queueConcurrency: clampQueueConcurrency(p.queueConcurrency),
          vaultMirrorFolder: p.vaultMirrorFolder !== false,
          downloadToFolder: p.downloadToFolder !== false,
          pathPreset,
          pathTemplate,
          folderLabel: typeof p.folderLabel === "string" ? p.folderLabel : "",
          savedTags: parseSavedTags(p.savedTags),
          smartFolders: parseSmartFolders(p.smartFolders),
          onboarded:
            p.onboarded === true ||
            legacy.accounts.some((a) => Boolean(a.pixivCookie || a.fanboxCookie)),
          saucenaoApiKey: typeof p.saucenaoApiKey === "string" ? p.saucenaoApiKey.trim().slice(0, 80) : "",
          danbooruLogin: typeof p.danbooruLogin === "string" ? p.danbooruLogin.trim().slice(0, 120) : "",
          danbooruApiKey: typeof p.danbooruApiKey === "string" ? p.danbooruApiKey.trim().slice(0, 200) : "",
        };
        if (version >= 2 && legacy.accounts.length) {
          return { ...p, ...legacy, ...cookies, searchEngine, hideAi, theme, appearance, ...extra };
        }
        return { ...p, ...legacy, ...cookies, searchEngine, hideAi, theme, appearance, ...extra };
      },
      partialize: (s) => ({
        pixivCookie: s.pixivCookie,
        fanboxCookie: s.fanboxCookie,
        danbooruLogin: s.danbooruLogin,
        danbooruApiKey: s.danbooruApiKey,
        safeMode: s.safeMode,
        hideAi: s.hideAi,
        downloadOriginal: s.downloadOriginal,
        queueConcurrency: s.queueConcurrency,
        vaultMirrorFolder: s.vaultMirrorFolder,
        downloadToFolder: s.downloadToFolder,
        pathPreset: s.pathPreset,
        pathTemplate: s.pathTemplate,
        folderLabel: s.folderLabel,
        tab: s.tab,
        searchEngine: s.searchEngine,
        saucenaoApiKey: s.saucenaoApiKey,
        recents: s.recents,
        savedTags: s.savedTags,
        smartFolders: s.smartFolders,
        accounts: s.accounts,
        activeAccountId: s.activeAccountId,
        theme: s.theme,
        appearance: s.appearance,
        onboarded: s.onboarded,
      }),
    },
  ),
);

/** 设置从 localStorage 水合完再开浏览请求，queryKey 才能对上浏览器缓存。 */
export function useSettingsHydrated(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onPersisted(useSettings, onStoreChange),
    () => Boolean(useSettings.persist?.hasHydrated?.()),
    // 水合完成前客户端必须和服务端同帧：persist 是同步重水合的，
    // 若在水合渲染里读 true，SSR 出来的 disabled / 分支会对不上，触发 hydration 警告。
    () => false,
  );
}

export function cookiesFromSettings(): {
  pixivCookie?: string;
  fanboxCookie?: string;
  danbooruLogin?: string;
  danbooruApiKey?: string;
  safeMode: boolean;
  hideAi: boolean;
} {
  const s = useSettings.getState();
  const pixiv = sanitizePixivCookie(s.pixivCookie);
  const fanbox = fanboxSessionFrom(s.fanboxCookie, pixiv);
  return {
    pixivCookie: pixiv || undefined,
    fanboxCookie: fanbox || undefined,
    danbooruLogin: s.danbooruLogin || undefined,
    danbooruApiKey: s.danbooruApiKey || undefined,
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
          const live = s.items.find((x) => x.key === item.key && (x.status === "queued" || x.status === "running"));
          if (live) {
            if (item.kind === "download" && live.kind !== "download") {
              return {
                items: s.items.map((x) => (x.key === item.key ? { ...x, kind: "download" as const } : x)),
              };
            }
            return s;
          }
          const next: QueueItem = {
            ...item,
            kind: item.kind === "vault" ? "vault" : "download",
            status: "queued",
            progress: 0,
            total: 1,
            addedAt: Date.now(),
            error: undefined,
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
