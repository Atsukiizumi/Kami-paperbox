/**
 * 保存/导出的落盘入口。
 *
 * 作用：收入纸匣时同时写入 IndexedDB；若设置了本机文件夹，再按路径模板镜像一份，
 *      并把相对路径写回目录，方便以后按文件夹搜。
 * 用法：archiveWork(work, pages, { download })；只导出用 exportVaultItem。
 * 为什么双写：浏览器里要能预览（IDB Blob），备份和按作者归档要靠真实文件夹。
 *        文件夹一多就没法搜，所以路径必须记进目录，而不是只丢在磁盘上。
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
): Promise<{ folder: boolean; folderSkipped: boolean }> {
  await saveVaultWork(work, pages);
  const settings = useSettings.getState();
  const at = new Date();
  const wantFolder =
    Boolean(settings.folderLabel) && (settings.vaultMirrorFolder || (opts.download && settings.downloadToFolder));
  let folder = false;
  if (wantFolder) {
    try {
      const path = await writeWorkToFolder(work, pages, at);
      folder = Boolean(path);
      if (path) {
        await patchVaultMeta(`${work.source}:${work.id}`, {
          relativePath: path,
          folderLabel: settings.folderLabel,
        });
      }
    } catch {
      folder = false;
    }
  }
  if (opts.download && !folder) {
    for (let i = 0; i < pages.length; i += 1) {
      const item = pages[i];
      if (!item) continue;
      const ext = extFromNameOrType(item.page.name, item.blob.type);
      const relative = relativePathFor(work, i, ext, at);
      downloadBlob(item.blob, flattenDownloadName(relative));
    }
  }
  return { folder, folderSkipped: wantFolder && !folder };
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
