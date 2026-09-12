/**
 * 本机备份：设置、账号、纸匣目录、词表。
 *
 * 作用：把 localStorage 里的设置/账号和纸匣记录收成一份 JSON，再读回来。
 * 用法：buildBackup(...) 导出；parseBackup(json) 导入前校验。
 * 为什么：清站点数据或换浏览器会丢掉 Cookie 和纸匣索引。原图仍在用户文件夹 / `.data/vault`，
 *        这份文件只记目录和登录，不把像素 base64 进去。
 */
import { cookiesOf, migrateLegacySettings, type Account } from "./accounts.ts";
import { fanboxSessionFrom, sanitizePixivCookie } from "./browser-login.ts";
import { DEFAULT_PATH_TEMPLATE, parsePathPreset, templateForPreset, type PathPreset } from "./download-path.ts";
import { parseProxyUrl } from "./proxy-url.ts";
import { clampQueueConcurrency } from "./queue-retry.ts";
import { parseSearchEngine, type SearchEngine } from "./reverse-search.ts";
import { parseSavedTags } from "./site-tags.ts";
import { parseSmartFolders, type SmartFolder } from "./vault-query.ts";
import { clampWatchLimit, parseWatchArtists, type WatchArtist } from "./watch.ts";
import { isSource, parseSource } from "./sites.ts";
import { parseAppearance, parseThemeId, type Appearance, type ThemeId } from "./theme.ts";
import type { TagCatalogEntry } from "./tag-catalog.ts";
import { parseTagLexicon, type TagLexiconRow } from "./tag-lexicon.ts";
import type { Source, VaultMeta } from "./types.ts";
import {
  parseAuthorHistory,
  parseHistoryItems,
  type AuthorHistoryEntry,
  type HistoryEntry,
} from "./view-history.ts";

export const BACKUP_FORMAT = "kami-paperbox-backup-v1";
/**
 * v2（SEC-03）：与 v1 同构，但可把「设置 + 代理地址」整段换成 settingsCipher
 * （PBKDF2+AES-GCM 容器，见 crypto-box.ts）——密文覆盖凭据与代理密码两个
 * 敏感段；vault / 词表 / 历史是目录性数据，保持明文便于检查内容。
 * v1 文件永远可直接导入。
 */
export const BACKUP_FORMAT_V2 = "kami-paperbox-backup-v2";

export type BackupSettings = {
  pixivCookie: string;
  fanboxCookie: string;
  danbooruLogin: string;
  danbooruApiKey: string;
  safeMode: boolean;
  hideAi: boolean;
  downloadOriginal: boolean;
  queueConcurrency?: number;
  vaultMirrorFolder: boolean;
  downloadToFolder: boolean;
  pathPreset: PathPreset;
  pathTemplate: string;
  folderLabel: string;
  tab: Source;
  searchEngine: SearchEngine;
  saucenaoApiKey: string;
  recents: string[];
  savedTags: Record<Source, string[]>;
  smartFolders: SmartFolder[];
  watchArtists: WatchArtist[];
  watchLimit: number;
  accounts: Account[];
  activeAccountId: string | null;
  theme: ThemeId;
  appearance: Appearance;
  onboarded: boolean;
};

export type BackupHistory = {
  items: HistoryEntry[];
  authors: AuthorHistoryEntry[];
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  exportedAt: number;
  settings: BackupSettings;
  vault: VaultMeta[];
  lexicon: TagLexiconRow[];
  catalog: TagCatalogEntry[];
  history: BackupHistory;
  proxyUrl: string;
};

export type ParseBackupResult = { ok: true; backup: BackupFile } | { ok: false; error: string };

export type BackupInput = {
  settings: BackupSettings;
  vault?: unknown;
  lexicon?: unknown;
  catalog?: unknown;
  history?: { items?: unknown; authors?: unknown };
  proxyUrl?: string;
  now?: number;
};

function parseBackupKey(raw: string): { source: Source; id: string } | null {
  const cut = raw.indexOf(":");
  if (cut <= 0) return null;
  const source = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (!isSource(source)) return null;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return null;
  return { source, id };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parseProfile(raw: unknown): Account["pixivProfile"] {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (!id && !name) return null;
  const avatar = typeof rec.avatar === "string" ? rec.avatar : undefined;
  return { id: id || name, name: name || id, avatar };
}

function parseAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return [];
  const out: Account[] = [];
  for (const row of raw) {
    const rec = asRecord(row);
    if (!rec) continue;
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `acc-${out.length + 1}`;
    const pixivCookie = sanitizePixivCookie(typeof rec.pixivCookie === "string" ? rec.pixivCookie : "");
    const fanboxCookie = fanboxSessionFrom(
      typeof rec.fanboxCookie === "string" ? rec.fanboxCookie : "",
      pixivCookie,
    );
    out.push({
      id,
      name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : "未命名",
      pixivCookie,
      fanboxCookie,
      pixivProfile: pixivCookie ? parseProfile(rec.pixivProfile) : null,
      fanboxProfile: fanboxCookie ? parseProfile(rec.fanboxProfile) : null,
    });
  }
  return out;
}

function parseRecents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}

export function parseBackupSettings(raw: unknown): BackupSettings {
  const p = asRecord(raw) ?? {};
  const accountsIn = parseAccounts(p.accounts);
  const legacy = migrateLegacySettings({
    pixivCookie: typeof p.pixivCookie === "string" ? p.pixivCookie : "",
    fanboxCookie: typeof p.fanboxCookie === "string" ? p.fanboxCookie : "",
    accounts: accountsIn.length ? accountsIn : undefined,
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
  const pathPreset = parsePathPreset(p.pathPreset);
  const pathTemplate =
    typeof p.pathTemplate === "string" && p.pathTemplate.trim()
      ? p.pathTemplate
      : templateForPreset(pathPreset, DEFAULT_PATH_TEMPLATE);
  return {
    pixivCookie: cookies.pixivCookie,
    fanboxCookie: cookies.fanboxCookie,
    safeMode: p.safeMode !== false,
    hideAi: p.hideAi === true,
    downloadOriginal: p.downloadOriginal !== false,
    queueConcurrency: clampQueueConcurrency(p.queueConcurrency),
    vaultMirrorFolder: p.vaultMirrorFolder !== false,
    downloadToFolder: p.downloadToFolder !== false,
    pathPreset,
    pathTemplate,
    folderLabel: typeof p.folderLabel === "string" ? p.folderLabel : "",
    tab: parseSource(typeof p.tab === "string" ? p.tab : "pixiv"),
    searchEngine: parseSearchEngine(typeof p.searchEngine === "string" ? p.searchEngine : undefined),
    saucenaoApiKey: typeof p.saucenaoApiKey === "string" ? p.saucenaoApiKey.trim().slice(0, 80) : "",
    danbooruLogin: typeof p.danbooruLogin === "string" ? p.danbooruLogin.trim().slice(0, 120) : "",
    danbooruApiKey: typeof p.danbooruApiKey === "string" ? p.danbooruApiKey.trim().slice(0, 200) : "",
    recents: parseRecents(p.recents),
    savedTags: parseSavedTags(p.savedTags),
    smartFolders: parseSmartFolders(p.smartFolders),
    watchArtists: parseWatchArtists(p.watchArtists, clampWatchLimit(p.watchLimit)),
    watchLimit: clampWatchLimit(p.watchLimit),
    accounts: legacy.accounts,
    activeAccountId: legacy.activeAccountId,
    theme: parseThemeId(p.theme),
    appearance: parseAppearance(p.appearance),
    onboarded: p.onboarded === true || legacy.accounts.some((a) => Boolean(a.pixivCookie || a.fanboxCookie)),
  };
}

export function parseVaultRecord(raw: unknown): VaultMeta | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const source = typeof rec.source === "string" ? rec.source : "";
  const id = typeof rec.id === "string" ? rec.id : "";
  const key = typeof rec.key === "string" && rec.key ? rec.key : `${source}:${id}`;
  const parsed = parseBackupKey(key);
  if (!parsed) return null;
  const tags = Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string").slice(0, 80) : [];
  const origin = rec.origin === "folder" || rec.origin === "app" ? rec.origin : undefined;
  return {
    key: `${parsed.source}:${parsed.id}`,
    source: parsed.source,
    id: parsed.id,
    title: typeof rec.title === "string" && rec.title.trim() ? rec.title : "无题",
    author: typeof rec.author === "string" ? rec.author : "",
    authorId: typeof rec.authorId === "string" ? rec.authorId : "",
    tags,
    pageCount: Math.max(0, Number(rec.pageCount) || 0),
    savedAt: Number(rec.savedAt) || 0,
    bytes: Math.max(0, Number(rec.bytes) || 0),
    relativePath: typeof rec.relativePath === "string" ? rec.relativePath : undefined,
    folderLabel: typeof rec.folderLabel === "string" ? rec.folderLabel : undefined,
    sha256: typeof rec.sha256 === "string" ? rec.sha256 : undefined,
    replaced: rec.replaced === true ? true : undefined,
    origin,
  };
}

export function parseVaultRecords(raw: unknown): VaultMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: VaultMeta[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const meta = parseVaultRecord(row);
    if (!meta || seen.has(meta.key)) continue;
    seen.add(meta.key);
    out.push(meta);
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function parseCatalog(raw: unknown): TagCatalogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TagCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const rec = asRecord(row);
    if (!rec) continue;
    const en = typeof rec.en === "string" ? rec.en.trim().toLowerCase() : "";
    if (!en || seen.has(en)) continue;
    seen.add(en);
    const sites = Array.isArray(rec.sites)
      ? rec.sites.filter((s): s is TagCatalogEntry["sites"][number] => s === "yande" || s === "konachan" || s === "danbooru")
      : [];
    out.push({
      en,
      count: Math.max(0, Number(rec.count) || 0),
      lastSeen: Number(rec.lastSeen) || 0,
      sites,
    });
  }
  return out;
}

function parseProxy(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const parsed = parseProxyUrl(raw);
  return parsed.ok ? parsed.href : "";
}

export function buildBackup(input: BackupInput): BackupFile {
  const settings = parseBackupSettings(input.settings);
  return {
    format: BACKUP_FORMAT,
    exportedAt: input.now ?? Date.now(),
    settings,
    vault: parseVaultRecords(input.vault ?? []),
    lexicon: parseTagLexicon(input.lexicon ?? []),
    catalog: parseCatalog(input.catalog ?? []),
    history: {
      items: parseHistoryItems(input.history?.items ?? []),
      authors: parseAuthorHistory(input.history?.authors ?? []),
    },
    proxyUrl: parseProxy(input.proxyUrl ?? ""),
  };
}

/**
 * v2 加密形态的密文载荷（settings + proxyUrl 打包）。
 * open 可以为空：此时读到加密文件返回明确错误，由调用方收集口令后重试。
 */
export type ParseBackupOptions = {
  open?: (cipher: import("./crypto-box.ts").CipherBox) => Promise<{ settings: unknown; proxyUrl?: unknown }>;
};

export function parseBackup(raw: unknown, opts: ParseBackupOptions = {}): ParseBackupResult {
  const rec = asRecord(raw);
  if (!rec) return { ok: false, error: "不是纸匣备份文件" };
  const v1 = rec.format === BACKUP_FORMAT;
  const v2 = rec.format === BACKUP_FORMAT_V2;
  if (!v1 && !v2) return { ok: false, error: "不是纸匣备份，或版本不对" };
  const cipher = asRecord(rec.settingsCipher);
  if (v2 && cipher && typeof cipher.ct === "string") {
    if (!opts.open) return { ok: false, error: "这份备份用口令加密了，请填口令后重试" };
    // 异步解密由 parseBackupFile 承担；同步路径（如服务端校验）只认形态
    return { ok: false, error: "这份备份用口令加密了，请填口令后重试" };
  }
  try {
    const backup = buildBackup({
      settings: parseBackupSettings(rec.settings),
      vault: Array.isArray(rec.vault) ? rec.vault : [],
      lexicon: rec.lexicon,
      catalog: rec.catalog,
      history: asRecord(rec.history) ?? undefined,
      proxyUrl: typeof rec.proxyUrl === "string" ? rec.proxyUrl : "",
      now: Number(rec.exportedAt) || Date.now(),
    });
    backup.exportedAt = Number(rec.exportedAt) || backup.exportedAt;
    return { ok: true, backup };
  } catch {
    return { ok: false, error: "备份文件读不出来" };
  }
}

/** 同步解析（含 v2 加密形态）：需要口令时用 opts.open 解开 settings 段。 */
export async function parseBackupFile(
  raw: unknown,
  opts: ParseBackupOptions = {},
): Promise<ParseBackupResult> {
  const rec = asRecord(raw);
  const cipher = rec ? asRecord(rec.settingsCipher) : null;
  if (rec && cipher && typeof cipher.ct === "string") {
    if (!opts.open) return { ok: false, error: "这份备份用口令加密了，请填口令后重试" };
    let opened: { settings: unknown; proxyUrl?: unknown };
    try {
      opened = await opts.open(cipher as import("./crypto-box.ts").CipherBox);
    } catch {
      return { ok: false, error: "口令不对" };
    }
    const { settingsCipher: _drop, ...rest } = rec;
    return parseBackup({
      ...rest,
      format: BACKUP_FORMAT_V2,
      settings: opened.settings,
      proxyUrl: typeof opened.proxyUrl === "string" ? opened.proxyUrl : "",
    });
  }
  return parseBackup(raw);
}

export function mergeVaultRecords(current: VaultMeta[], incoming: VaultMeta[]): VaultMeta[] {
  const map = new Map<string, VaultMeta>();
  for (const row of current) map.set(row.key, row);
  for (const row of incoming) map.set(row.key, row);
  return [...map.values()].sort((a, b) => b.savedAt - a.savedAt);
}

export function backupFilename(at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `kami-paperbox-backup-${y}${m}${d}.json`;
}
