/**
 * 保存/导出的落盘入口。
 *
 * 作用：对应开关开着且能选文件夹时，原图写用户指定目录，纸匣记路径和 SHA-256，
 *      并写一条服务端目录（不含像素），删除才能进纸篓、放回去才有目录。
 *      收入纸匣看「收入纸匣时写入文件夹」，下载看「下载写入该文件夹」。
 *      开关关着，或选不了文件夹（Safari / 火狐 / 手机），像素放进应用内目录；
 *      下载则改走浏览器下载。
 * 用法：只从队列 runner 调 archiveWork。
 */
import { extFromNameOrType } from "../ugoira-meta.ts";
import { applyAuthorAlias, normalizeAuthorName } from "../author-name.ts";
import {
  flattenDownloadName,
  formatDownloadPath,
  type PathContext,
} from "./download-path.ts";
import {
  ensureFolderPermission,
  canPickFolder,
  readRelativeFile,
  writeRelativeFile,
} from "../folder-access.ts";
import { sha256Hex } from "./file-hash.ts";
import { useSettings } from "../store.ts";
import type { VaultMeta, WorkDetail, WorkPage } from "../types.ts";
import { downloadBlob, listVault, patchVaultMeta, saveVaultWork } from "./vault.ts";
import { rememberVaultKey } from "./vault-index.ts";
import { patchServerVault, pushVaultMetaToServer, pushVaultToServer, type SimilarVaultHit } from "./vault-sync.ts";

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
    // {author} 用预解析值：规范化 + 用户别名（download-path 不引 store，
    // 别名在这里从设置段取，镜像路径与导出/统计同一套画师口径）
    authorName: applyAuthorAlias(normalizeAuthorName(work.author), useSettings.getState().authorAliases),
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

/** 收入纸匣看镜像开关，下载看下载开关。两个都默认开。 */
export function folderWriteEnabled(
  download: boolean,
  settings: { downloadToFolder: boolean; vaultMirrorFolder: boolean },
): boolean {
  return download ? settings.downloadToFolder : settings.vaultMirrorFolder;
}

export async function archiveWork(
  work: WorkDetail,
  pages: { blob: Blob; page: WorkPage }[],
  opts: { download: boolean },
): Promise<{ folder: boolean; folderSkipped: boolean; server: boolean; similar?: SimilarVaultHit[] }> {
  const settings = useSettings.getState();
  const at = new Date();
  const wantFolder = folderWriteEnabled(opts.download, settings);
  const folderHandle = wantFolder && canPickFolder() ? await ensureFolderPermission() : null;
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
  // 文件夹模式只推目录（像素留在用户文件夹）。没有这条服务端记录时，
  // 删除无行可软删，纸篓是空的，提示却说可以放回去。
  // 应用内模式仍整包推送，收重提示走像素 PUT 的 similar。
  let server = false;
  let similar: SimilarVaultHit[] | undefined;
  if (folder) {
    server = Boolean(await pushVaultMetaToServer(serverMeta));
  } else {
    const pushed = await pushVaultToServer(serverMeta, files);
    server = Boolean(pushed);
    similar = pushed?.similar;
  }
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
  return { folder, folderSkipped: preferFolder && !folder, server, similar };
}

/**
 * 扫描一张之后：标记要不要改、这次要不要计入「已被替换」。
 *
 * 文件不在了也算已被替换。已经标过的，再扫一次仍然计入——
 * 只在第一次加计数的话，第二次提示会说成「原图一致」。
 * 哈希对上了就清掉标记，并且不计入。
 */
export function folderScanUpdate(
  alreadyReplaced: boolean,
  found: { missing: true } | { sha256: string },
  expectedSha256: string,
): { replaced: boolean; count: boolean; write: boolean } {
  if ("missing" in found) {
    return { replaced: true, count: true, write: !alreadyReplaced };
  }
  const mismatch = found.sha256 !== expectedSha256;
  return { replaced: mismatch, count: mismatch, write: mismatch !== alreadyReplaced };
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
    const found = file ? { sha256: await sha256Hex(file) } : { missing: true as const };
    const update = folderScanUpdate(Boolean(item.replaced), found, item.sha256);
    if (update.write) await patchVaultMeta(item.key, { replaced: update.replaced });
    if (update.count) replaced += 1;
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
