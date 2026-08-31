/**
 * 保存/导出的落盘入口。
 *
 * 作用：收入纸匣时写入浏览器 IndexedDB，并推到本机 Node 目录（SQLite + 原图文件）；
 *      若设置了文件夹，再按路径模板镜像一份。
 * 用法：archiveWork(work, pages, { download })；只导出用 exportVaultItem。
 * 为什么三写：浏览器要能立刻预览；Node `.data/vault` 才扛得住量和查询；
 *        用户文件夹方便在资源管理器里翻，但路径必须记进目录才能搜。
 */
import { extFromNameOrType } from "./ugoira-meta";
import {
  flattenDownloadName,
  formatDownloadPath,
  type PathContext,
} from "./download-path";
import {
  ensureFolderPermission,
  writeRelativeFile,
} from "./folder-access";
import { useSettings } from "./store";
import type { VaultMeta, WorkDetail, WorkPage } from "./types";
import { downloadBlob, patchVaultMeta, saveVaultWork } from "./vault";
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
  const meta = await saveVaultWork(work, pages);
  const files = pages.map((item) => ({
    blob: item.blob,
    ext: extFromNameOrType(item.page.name, item.blob.type),
  }));
  const settings = useSettings.getState();
  const at = new Date();
  const wantFolder =
    Boolean(settings.folderLabel) && (settings.vaultMirrorFolder || (opts.download && settings.downloadToFolder));
  let folder = false;
  let relativePath: string | undefined;
  if (wantFolder) {
    try {
      const path = await writeWorkToFolder(work, pages, at);
      folder = Boolean(path);
      if (path) {
        relativePath = path;
        await patchVaultMeta(meta.key, {
          relativePath: path,
          folderLabel: settings.folderLabel,
        });
      }
    } catch {
      folder = false;
    }
  }
  const serverMeta = {
    ...meta,
    relativePath: relativePath ?? meta.relativePath,
    folderLabel: relativePath ? settings.folderLabel : meta.folderLabel,
  };
  const server = Boolean(await pushVaultToServer(serverMeta, files));
  if (opts.download && !folder) {
    for (let i = 0; i < pages.length; i += 1) {
      const item = pages[i];
      if (!item) continue;
      const ext = extFromNameOrType(item.page.name, item.blob.type);
      const relative = relativePathFor(work, i, ext, at);
      downloadBlob(item.blob, flattenDownloadName(relative));
    }
  }
  return { folder, folderSkipped: wantFolder && !folder, server };
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
