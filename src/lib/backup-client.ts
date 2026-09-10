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
  parseBackup,
  parseBackupFile,
  parseBackupSettings,
  type BackupFile,
  type BackupSettings,
} from "./backup.ts";
import { deriveBoxKey, openJson, randomSaltB64, sealJson, type CipherBox } from "./crypto-box.ts";
import { useSettings } from "./store.ts";
import { useTagCatalog } from "./tag-catalog.ts";
import { useTagLexicon } from "./tag-lexicon.ts";
import { downloadBlob, listVault, putVaultMeta } from "./vault.ts";
import { rememberVaultKey, useVaultIndex } from "./vault-index.ts";
import { listServerVault, pushVaultMetaToServer } from "./vault-sync.ts";
import { useViewHistory } from "./view-history.ts";

function snapshotSettings(): BackupSettings {
  const s = useSettings.getState();
  return parseBackupSettings({
    pixivCookie: s.pixivCookie,
    fanboxCookie: s.fanboxCookie,
    danbooruLogin: s.danbooruLogin,
    danbooruApiKey: s.danbooruApiKey,
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
    saucenaoApiKey: s.saucenaoApiKey,
    recents: s.recents,
    savedTags: s.savedTags,
    accounts: s.accounts,
    activeAccountId: s.activeAccountId,
    theme: s.theme,
    appearance: s.appearance,
    onboarded: s.onboarded,
  });
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
