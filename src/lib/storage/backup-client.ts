/**
 * 浏览器里收集 / 写回备份。
 *
 * 作用：从 zustand、IndexedDB、本机纸匣目录拼出 JSON；导入时写回去并同步登录 Cookie。
 * 用法：collectBackup()；applyBackup(file)。不要在 Node 测试里跑（依赖 indexedDB / fetch）。
 */
import {
  BACKUP_FORMAT_V2,
  backupFilename,
  buildBackup,
  mergeVaultRecords,
  parseBackupFile,
  parseBackupSettings,
  parseCatalog,
  parseVaultRecords,
  preserveClientVaultFields,
  type BackupFile,
  type BackupSettings,
} from "./backup.ts";
import { deriveBoxKey, openJson, randomSaltB64, sealJson, type CipherBox } from "./crypto-box.ts";
import { useSettings, type SettingsState } from "../store.ts";
import { useTagCatalog } from "../tag-catalog.ts";
import { parseTagLexicon, useTagLexicon } from "../tag-lexicon.ts";
import { downloadBlob, getVaultMeta, listVault, putVaultMeta } from "./vault.ts";
import { rememberVaultKey, useVaultIndex } from "./vault-index.ts";
import { listServerVault, pushVaultMetaToServer } from "./vault-sync.ts";
import { parseAuthorHistory, parseHistoryItems, useViewHistory } from "../view-history.ts";

/**
 * 设置段采集白名单（「结构性列表漏采事故」回归锁，smartFolders / watchArtists /
 * tagAliases / collections / X 三段同款陷阱位）：漏采 = 推不进同步段 + 备份文件，
 * 拉取侧 parse 的空默认值还会把本地整份抹掉。测试交叉断言本清单与 store 的
 * SETTINGS_PERSIST_FIELDS、backup 的 BACKUP_SETTINGS_FIELDS 一致。
 * 注意与那两处的有意差异：queueConcurrency 不进同步段（每台设备自己的并发），
 * lastBackupAt 只留本机（备份提醒不跨设备）。
 */
export const SNAPSHOT_SETTINGS_FIELDS = [
  "pixivCookie",
  "fanboxCookie",
  "danbooruLogin",
  "danbooruApiKey",
  "safeModeBySite",
  "hideAi",
  "downloadOriginal",
  "vaultMirrorFolder",
  "downloadToFolder",
  "pathPreset",
  "pathTemplate",
  "folderLabel",
  "tab",
  "searchEngine",
  "saucenaoApiKey",
  "recents",
  "savedTags",
  "authorAliases",
  // 标签别名（标签整理）：结构性列表同款陷阱位——漏采则推不进同步段，拉取还清空本地
  "tagAliases",
  // 结构性列表：曾长期漏在这里——推不进同步段/备份文件，拉取侧还会用空默认值清掉本地
  "smartFolders",
  "watchArtists",
  "watchLimit",
  // 标签订阅（v14）：结构性列表同款陷阱位——漏采则推不进同步段，拉取还清空本地
  "watchTags",
  // 手工合集（v15）：结构性列表同款陷阱位——漏采则推不进同步段，拉取还清空本地
  "collections",
  // X 账号关联（v16）：xCookie / xAssociations / xGraphQLQueryIds 同款陷阱位
  "xCookie",
  "xAssociations",
  "xGraphQLQueryIds",
  "accounts",
  "activeAccountId",
  "theme",
  "appearance",
  "uiStyle",
  // 动效总开关（v17）：同款陷阱位——漏采则推不进同步段，拉取还清空本地
  "motionEnabled",
  // 布局引擎 P1（v18）：案头版式/外壳/页参数——漏采则重启丢、拉取清空
  "deskPresets",
  "activeDeskPresetId",
  "shell",
  "pageLayout",
  // 主题包激活指针（v19）：同款陷阱位——漏采则拉取清空本地指针（回默认观感）
  "themePack",
  "onboarded",
] as const satisfies readonly (keyof SettingsState)[];

/** 设置段采集：按白名单键清单从 store 取值再过 parseBackupSettings 清洗。导出仅供测试断言字段齐全。 */
export function snapshotSettings(): BackupSettings {
  const s = useSettings.getState() as unknown as Record<string, unknown>;
  return parseBackupSettings(Object.fromEntries(SNAPSHOT_SETTINGS_FIELDS.map((k) => [k, s[k]])));
}

async function readProxyUrl(): Promise<string> {
  try {
    const res = await fetch("/api/proxy", { cache: "no-store" });
    const data = (await res.json()) as { url?: string };
    return typeof data.url === "string" ? data.url : "";
  } catch {
    return "";
  }
}

export async function collectBackup(): Promise<BackupFile> {
  const local = await listVault();
  const remote = await listServerVault();
  const history = useViewHistory.getState();
  return buildBackup({
    settings: snapshotSettings(),
    vault: mergeVaultRecords(local, remote?.items ?? []),
    lexicon: useTagLexicon.getState().rows,
    catalog: useTagCatalog.getState().entries,
    history: { items: history.items, authors: history.authors },
    proxyUrl: await readProxyUrl(),
  });
}

/**
 * 导出备份。给了 passphrase 就出 v2 加密文件（设置 + 代理地址整段密文），
 * 否则仍是明文 v1——老用户零感知，需要外发备份的人自行勾选。
 */
export async function downloadBackup(passphrase?: string): Promise<{ accounts: number; vault: number }> {
  const backup = await collectBackup();
  let file: Record<string, unknown>;
  if (passphrase) {
    const salt = randomSaltB64();
    const key = await deriveBoxKey(passphrase, salt);
    const settingsCipher = await sealJson(key, { settings: backup.settings, proxyUrl: backup.proxyUrl }, salt);
    const { settings: _s, proxyUrl: _p, ...rest } = backup;
    file = { ...rest, format: BACKUP_FORMAT_V2, settingsCipher };
  } else {
    file = backup;
  }
  const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json" });
  downloadBlob(blob, backupFilename());
  return { accounts: backup.settings.accounts.length, vault: backup.vault.length };
}

/**
 * 按「同步分段」应用一段数据（docs/17）：settings 段含 proxyUrl；
 * vault 段合并写入；lexicon 段含词表 + 目录；history 段整组替换。
 * 与 applyBackup 共用各段的写入方式，只是范围更小。
 */
export async function applySegment(
  segment: "settings" | "vault" | "lexicon" | "history",
  data: unknown,
): Promise<void> {
  if (segment === "settings") {
    const seg = data as { settings?: unknown; proxyUrl?: unknown };
    const raw = (seg.settings ?? {}) as Record<string, unknown>;
    const settings = parseBackupSettings(seg.settings ?? {});
    // 升级窗口防清空：旧远端载荷不含 smartFolders/watchArtists 字段，parse 默认空数组
    // 会把本地整份抹掉。字段缺失 + 本地非空 → 保留本地；字段显式为空（用户真清空）→ 照常应用。
    // tagAliases / authorAliases 同款守卫（#151 白名单陷阱实证位；authorAliases 2026-09-17 补）。
    const local = useSettings.getState();
    const hasField = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
    if (!hasField("smartFolders") && local.smartFolders.length > 0) settings.smartFolders = local.smartFolders;
    if (!hasField("watchArtists") && local.watchArtists.length > 0) settings.watchArtists = local.watchArtists;
    // 标签订阅（v14）：旧远端载荷不含 watchTags，parse 默认空表会把本地整份抹掉
    if (!hasField("watchTags") && local.watchTags.length > 0) settings.watchTags = local.watchTags;
    // 手工合集（v15）：旧远端载荷不含 collections，parse 默认空表会把本地整份抹掉
    if (!hasField("collections") && local.collections.length > 0) settings.collections = local.collections;
    if (!hasField("tagAliases") && Object.keys(local.tagAliases).length > 0) settings.tagAliases = local.tagAliases;
    if (!hasField("authorAliases") && Object.keys(local.authorAliases).length > 0) settings.authorAliases = local.authorAliases;
    // X 设置段（v16）：旧远端载荷不含这三字段，parse 默认值（""/{}/{}）会把本地清空
    if (!hasField("xAssociations") && Object.keys(local.xAssociations).length > 0) settings.xAssociations = local.xAssociations;
    if (!hasField("xGraphQLQueryIds") && Object.keys(local.xGraphQLQueryIds).length > 0) {
      settings.xGraphQLQueryIds = local.xGraphQLQueryIds;
    }
    if (!hasField("xCookie") && local.xCookie) settings.xCookie = local.xCookie;
    // 升级窗口的账号级 X Cookie：远端整组账号里一个 xCookie 键都没有（<v16 推的档）
    // 时，按账号 id 保留本地值——accounts 是整组替换，不并会把顶层守卫保住的
    // xCookie 又经账号抹掉。远端账号带了 xCookie 键（含显式空串 = 用户真清了）则照用远端。
    const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    const remoteHasAccountX = rawAccounts.some(
      (rec) => rec != null && typeof rec === "object" && Object.prototype.hasOwnProperty.call(rec, "xCookie"),
    );
    if (!remoteHasAccountX) {
      const localById = new Map(local.accounts.map((a) => [a.id, a]));
      settings.accounts = settings.accounts.map((a) => ({
        ...a,
        xCookie: localById.get(a.id)?.xCookie ?? "",
      }));
    }
    useSettings.setState({ ...settings });
    await useSettings.getState().syncSessions();
    if (typeof seg.proxyUrl === "string" && seg.proxyUrl) {
      try {
        await fetch("/api/proxy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: seg.proxyUrl }),
        });
      } catch {
        /* proxy is optional */
      }
    }
    return;
  }
  if (segment === "vault") {
    for (const item of parseVaultRecords(Array.isArray(data) ? data : [])) {
      // 远端目录行缺 aiType/xRestrict/rating 时并上本地再写入，
      // 否则旧行同步一次就把分级/AI 标记清空（mergeVaultRecords 同款守卫）
      const local = await getVaultMeta(item.key);
      await putVaultMeta(preserveClientVaultFields(item, local));
      rememberVaultKey(item.source, item.id);
      await pushVaultMetaToServer(item);
    }
    await useVaultIndex.getState().refresh();
    return;
  }
  if (segment === "lexicon") {
    const seg = data as { lexicon?: unknown; catalog?: unknown };
    const rows = parseTagLexicon(seg.lexicon ?? []);
    useTagLexicon.getState().setRows(rows);
    useTagCatalog.setState({ entries: parseCatalog(seg.catalog ?? []) });
    return;
  }
  const seg = data as { items?: unknown[]; authors?: unknown[] };
  useViewHistory.setState({
    items: parseHistoryItems(Array.isArray(seg.items) ? seg.items : []),
    authors: parseAuthorHistory(Array.isArray(seg.authors) ? seg.authors : []),
  });
}

export async function applyBackup(raw: unknown, passphrase?: string): Promise<{ accounts: number; vault: number }> {
  const parsed = await parseBackupFile(raw, passphrase ? { open: (box) => openWith(passphrase, box) } : {});
  if (!parsed.ok) throw new Error(parsed.error);
  const { backup } = parsed;
  useSettings.setState({ ...backup.settings });
  await useSettings.getState().syncSessions();
  useTagLexicon.getState().setRows(backup.lexicon);
  useTagCatalog.setState({ entries: backup.catalog });
  useViewHistory.setState({
    items: backup.history.items,
    authors: backup.history.authors,
  });
  for (const item of backup.vault) {
    await putVaultMeta(item);
    rememberVaultKey(item.source, item.id);
    await pushVaultMetaToServer(item);
  }
  await useVaultIndex.getState().refresh();
  if (backup.proxyUrl) {
    try {
      await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: backup.proxyUrl }),
      });
    } catch {
      /* proxy is optional */
    }
  }
  return { accounts: backup.settings.accounts.length, vault: backup.vault.length };
}

export async function applyBackupFile(file: File, passphrase?: string): Promise<{ accounts: number; vault: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("不是 JSON");
  }
  return applyBackup(raw, passphrase);
}

/** 文件是否是加密形态（导入 UI 据此决定要不要先问口令）。 */
export function backupNeedsPassphrase(raw: unknown): boolean {
  const rec = raw as { settingsCipher?: unknown } | null;
  return Boolean(rec && typeof rec === "object" && rec.settingsCipher);
}

async function openWith(passphrase: string, box: CipherBox): Promise<{ settings: unknown; proxyUrl?: unknown }> {
  const key = await deriveBoxKey(passphrase, box.salt, box.iter);
  return openJson<{ settings: unknown; proxyUrl?: unknown }>(key, box);
}
