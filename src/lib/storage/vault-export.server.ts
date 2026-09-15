/**
 * 纸匣导出（E）：条目 → zip 内路径的纯映射。
 *
 * 作用：把 keys 解析成待打包清单（文件名/键/页码元数据）与跳过清单。
 * 为什么只出元数据不带字节（评审 #130）：字节必须在流式 pull 里逐页读——
 * 预读全部页会把整个包堆进内存，与「不整包进内存」的 spec 相悖。
 * 分夹名走 author-name 规范化 + 用户别名：同一画师的装饰名变体不再各开一夹
 * （别名表由客户端随请求带上，服务端保持无状态）。
 */
import { applyAuthorAlias, normalizeAuthorName } from "../author-name.ts";
import type { VaultMeta } from "../types.ts";
import type { VaultStore } from "./vault-store.server.ts";

export const EXPORT_MAX_KEYS = 400;

export type ExportItem = { name: string; key: string; page: number };
export type ExportSkip = { key: string; reason: "missing" | "no-file" | "read-error" };

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

export function listExportEntries(
  store: Pick<VaultStore, "get" | "pageExtList">,
  keys: string[],
  opts?: { authorAliases?: Record<string, string> },
): { items: ExportItem[]; skipped: ExportSkip[] } {
  const items: ExportItem[] = [];
  const skipped: ExportSkip[] = [];
  for (const key of keys) {
    const meta = store.get(key);
    if (!meta) {
      skipped.push({ key, reason: "missing" });
      continue;
    }
    const pages = store.pageExtList(key);
    if (pages.length === 0) {
      skipped.push({ key, reason: "no-file" });
      continue;
    }
    for (const { page, ext } of pages) {
      items.push({ name: entryName(meta, page, ext, opts?.authorAliases), key, page });
    }
  }
  return { items, skipped };
}
