/**
 * 保存/导出的落盘入口。
 *
 * 作用：能选文件夹时，原图只写用户指定目录，纸匣只记路径和 SHA-256。
 *      选不了文件夹（Safari / 火狐 / 手机）才退到应用内目录。
 * 用法：只从队列 runner 调 archiveWork。
 */
import { extFromNameOrType } from "./ugoira-meta";
import {
  flattenDownloadName,
  formatDownloadPath,
  type PathContext,
} from "./download-path";
import {
  ensureFolderPermission,
  canPickFolder,
  readRelativeFile,
  writeRelativeFile,
} from "./folder-access";
import { sha256Hex } from "./file-hash";
import { useSettings } from "./store";
import type { VaultMeta, WorkDetail, WorkPage } from "./types";
import { downloadBlob, listVault, patchVaultMeta, saveVaultWork } from "./vault";
import { rememberVaultKey } from "./vault-index";
import { patchServerVault, pushVaultToServer } from "./vault-sync";

export type ArchiveWork = {
  source: string;
  id: string;
  title: string;
  author: string;
  authorId?: string;
  tags?: string[];
};

export function archivePathContext(
  work: ArchiveWork,
  page: number,
  ext: string,
  at?: Date,
): PathContext {
  return {
    author: work.author,
    authorId: work.authorId ?? "",
    title: work.title,
    id: work.id,
    source: work.source,
    page,
    ext,
    tags: work.tags ?? [],
    at: at ?? new Date(),
  };
}

export function relativePathFor(
  work: ArchiveWork,
  page: number,
  ext: string,
  at?: Date,
): string {
  const template = useSettings.getState().pathTemplate;
  return formatDownloadPath(template, archivePathContext(work, page, ext, at));
}

export async function writeWorkToFolder(
  work: ArchiveWork,
  pages: { blob: Blob; page?: WorkPage; ext?: string }[],
  at?: Date,
): Promise<string | null> {
  const dir = await ensureFolderPermission();
  if (!dir) return null;
  let first = "";
  for (let i = 0; i < pages.length; i += 1) {
    const item = pages[i];
    if (!item) continue;
    const ext = item.ext ?? extFromNameOrType(item.page?.name, item.blob.type);
    const relative = relativePathFor(work, i, ext, at);
    await writeRelativeFile(dir, relative, item.blob);
    if (!first) first = relative;
  }
  return first || null;
}

export async function archiveWork(
  work: WorkDetail,
  pages: { blob: Blob; page: WorkPage }[],
  opts: { download: boolean },
): Promise<{ folder: boolean; folderSkipped: boolean; server: boolean }> {
  const settings = useSettings.getState();
  const at = new Date();
  const folderHandle = canPickFolder() ? await ensureFolderPermission() : null;
  const preferFolder = Boolean(folderHandle);
  let folder = false;
  let relativePath: string | undefined;
  if (preferFolder && folderHandle) {
    try {
      const path = await writeWorkToFolder(work, pages, at);
      folder = Boolean(path);
      if (path) relativePath = path;
    } catch {
      folder = false;
    }
  }
  const sha256 = pages[0] ? await sha256Hex(pages[0].blob) : undefined;
  const meta = await saveVaultWork(work, pages, {
    storeBlobs: !folder,
    sha256,
    relativePath,
    folderLabel: folder ? settings.folderLabel : undefined,
    origin: folder ? "folder" : "app",
    replaced: false,
  });
  const files = pages.map((item) => ({
    blob: item.blob,
    ext: extFromNameOrType(item.page.name, item.blob.type),
  }));
  const serverMeta = {
    ...meta,
    relativePath: relativePath ?? meta.relativePath,
    folderLabel: relativePath ? settings.folderLabel : meta.folderLabel,
  };
  const server = folder ? false : Boolean(await pushVaultToServer(serverMeta, files));
  rememberVaultKey(work.source, work.id);
  if (opts.download && !folder) {
    for (let i = 0; i < pages.length; i += 1) {
      const item = pages[i];
      if (!item) continue;
      const ext = extFromNameOrType(item.page.name, item.blob.type);
      const relative = relativePathFor(work, i, ext, at);
      downloadBlob(item.blob, flattenDownloadName(relative));
    }
  }
  return { folder, folderSkipped: preferFolder && !folder, server };
}

export async function rescanFolderHashes(): Promise<{ checked: number; replaced: number }> {
  const dir = canPickFolder() ? await ensureFolderPermission() : null;
  if (!dir) return { checked: 0, replaced: 0 };
  const items = await listVault();
  let checked = 0;
  let replaced = 0;
  for (const item of items) {
    if (!item.relativePath || !item.sha256) continue;
    checked += 1;
    const file = await readRelativeFile(dir, item.relativePath);
    if (!file) {
      if (!item.replaced) {
        await patchVaultMeta(item.key, { replaced: true });
        replaced += 1;
      }
      continue;
    }
    const hex = await sha256Hex(file);
    const mismatch = hex !== item.sha256;
    if (mismatch !== Boolean(item.replaced)) {
      await patchVaultMeta(item.key, { replaced: mismatch });
    }
    if (mismatch) replaced += 1;
  }
  return { checked, replaced };
}

export async function previewFromFolder(item: VaultMeta): Promise<Blob | undefined> {
  if (!item.relativePath) return undefined;
  const dir = canPickFolder() ? await ensureFolderPermission() : null;
  if (!dir) return undefined;
  const file = await readRelativeFile(dir, item.relativePath);
  return file ?? undefined;
}

export async function exportVaultItem(
  item: VaultMeta,
  pages: { blob: Blob; ext: string }[],
): Promise<{ folder: boolean }> {
  const settings = useSettings.getState();
  const at = new Date(item.savedAt);
  const wantFolder = Boolean(settings.folderLabel) && settings.downloadToFolder;
  if (wantFolder) {
    try {
      const path = await writeWorkToFolder(item, pages, at);
      if (path) {
        await patchVaultMeta(item.key, { relativePath: path, folderLabel: settings.folderLabel });
        await patchServerVault(item.key, { relativePath: path, folderLabel: settings.folderLabel });
        return { folder: true };
      }
    } catch {
      /* fall through to browser download */
    }
  }
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page) continue;
    const relative = relativePathFor(item, i, page.ext, at);
    downloadBlob(page.blob, flattenDownloadName(relative));
  }
  return { folder: false };
}
