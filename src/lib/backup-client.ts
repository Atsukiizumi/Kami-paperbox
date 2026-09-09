/**
 * 浏览器里收集 / 写回备份。
 *
 * 作用：从 zustand、IndexedDB、本机纸匣目录拼出 JSON；导入时写回去并同步登录 Cookie。
 * 用法：collectBackup()；applyBackup(file)。不要在 Node 测试里跑（依赖 indexedDB / fetch）。
 */
import {
  backupFilename,
  buildBackup,
  mergeVaultRecords,
  parseBackup,
  parseBackupSettings,
  type BackupFile,
  type BackupSettings,
} from "./backup";
import { useSettings } from "./store";
import { useTagCatalog } from "./tag-catalog";
import { useTagLexicon } from "./tag-lexicon";
import { downloadBlob, listVault, putVaultMeta } from "./vault";
import { rememberVaultKey, useVaultIndex } from "./vault-index";
import { listServerVault, pushVaultMetaToServer } from "./vault-sync";
import { useViewHistory } from "./view-history";

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

export async function downloadBackup(): Promise<{ accounts: number; vault: number }> {
  const backup = await collectBackup();
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
  downloadBlob(blob, backupFilename());
  return { accounts: backup.settings.accounts.length, vault: backup.vault.length };
}

export async function applyBackup(raw: unknown): Promise<{ accounts: number; vault: number }> {
  const parsed = parseBackup(raw);
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

export async function applyBackupFile(file: File): Promise<{ accounts: number; vault: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("不是 JSON");
  }
  return applyBackup(raw);
}
