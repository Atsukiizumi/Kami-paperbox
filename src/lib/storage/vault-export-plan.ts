/**
 * 纸匣导出的客户端分拣。
 *
 * 作用：决定一条藏品的原图从哪边进 ZIP。应用内目录有第 0 页（hasFile）的交给
 *      服务端流式打包；只在下载文件夹里的（hasFile 没标上，但 relativePath 还在）
 *      由浏览器读出来补进同一个包。两边都没有的跳过。
 * 为什么不把文件夹条目也 POST 给服务端：那些字节不在 `.data/vault/files`，
 *      服务端只会记成缺文件。
 */
import { unzipSync, zipSync } from "fflate";
import { applyAuthorAlias, normalizeAuthorName } from "../author-name.ts";
import type { VaultMeta } from "../types.ts";

export const EXPORT_MAX_KEYS = 400;

export type VaultExportPlan = {
  /** 应用内目录有原图，走 /api/vault/export。 */
  server: VaultMeta[];
  /** 原图只在用户文件夹里。 */
  folder: VaultMeta[];
  truncated: boolean;
};

/** 按当前筛选顺序收入可打包的条目，超过 max 的部分标 truncated 并丢掉。 */
export function partitionVaultExport(items: readonly VaultMeta[], max = EXPORT_MAX_KEYS): VaultExportPlan {
  const server: VaultMeta[] = [];
  const folder: VaultMeta[] = [];
  let truncated = false;
  for (const item of items) {
    const onServer = item.hasFile === true;
    const inFolder = !onServer && Boolean(item.relativePath);
    if (!onServer && !inFolder) continue;
    if (server.length + folder.length >= max) {
      truncated = true;
      break;
    }
    if (onServer) server.push(item);
    else folder.push(item);
  }
  return { server, folder, truncated };
}

/**
 * 文件夹里要读的路径。第 0 页用目录上记下的 relativePath。
 * 后面的页用调用方按保存规则推出来的路径；推不出、或和已有路径重复的，跳过。
 */
export function folderExportTargets(
  item: Pick<VaultMeta, "relativePath" | "pageCount">,
  pathForPage: (page: number) => string,
): { page: number; path: string }[] {
  const stored = item.relativePath;
  if (!stored) return [];
  const targets = [{ page: 0, path: stored }];
  const seen = new Set([stored]);
  const count = item.pageCount > 0 ? item.pageCount : 1;
  for (let page = 1; page < count; page += 1) {
    const path = pathForPage(page);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    targets.push({ page, path });
  }
  return targets;
}

function safeSeg(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "x";
}

/** 文件夹名：作者（规范化 + 别名，空则 unknown）；文件名：标题_source_id_p页.ext。 */
export function entryName(
  meta: Pick<VaultMeta, "author" | "title" | "source" | "id">,
  page: number,
  ext: string,
  aliases?: Record<string, string>,
): string {
  const author = safeSeg(applyAuthorAlias(normalizeAuthorName(meta.author || "unknown"), aliases) || "unknown");
  const base = `${safeSeg(meta.title || meta.id)}_${meta.source}_${safeSeg(meta.id)}_p${page}`;
  return `${author}/${base}.${(ext || "jpg").replace(/[^a-z0-9]/g, "")}`;
}

/**
 * 把文件夹里读到的原图补进服务端 ZIP。同名条目留下服务端那份。
 * serverZip 为空时，结果里只有文件夹原图。level 0：原图已经是压缩格式。
 */
export function zipWithFolderFiles(
  serverZip: Uint8Array | null,
  files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  const base: Record<string, Uint8Array> = serverZip ? unzipSync(serverZip) : {};
  for (const [name, bytes] of Object.entries(files)) {
    if (base[name]) continue;
    base[name] = bytes;
  }
  return zipSync(base, { level: 0 });
}
