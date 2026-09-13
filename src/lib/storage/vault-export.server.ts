/**
 * 纸匣导出（E）：条目 → zip 内路径的纯映射。
 *
 * 作用：把 keys 解析成待打包清单（文件名/键/页码元数据）与跳过清单。
 * 为什么只出元数据不带字节（评审 #130）：字节必须在流式 pull 里逐页读——
 * 预读全部页会把整个包堆进内存，与「不整包进内存」的 spec 相悖。
 */
import type { VaultMeta } from "../types.ts";
import type { VaultStore } from "./vault-store.server.ts";

export const EXPORT_MAX_KEYS = 400;

export type ExportItem = { name: string; key: string; page: number };
export type ExportSkip = { key: string; reason: "missing" | "no-file" | "read-error" };

function safeSeg(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "x";
}

/** 文件夹名：作者（空则 unknown）；文件名：标题_source_id_p页.ext。 */
export function entryName(
  meta: Pick<VaultMeta, "author" | "title" | "source" | "id">,
  page: number,
  ext: string,
): string {
  const author = safeSeg(meta.author || "unknown");
  const base = `${safeSeg(meta.title || meta.id)}_${meta.source}_${safeSeg(meta.id)}_p${page}`;
  return `${author}/${base}.${(ext || "jpg").replace(/[^a-z0-9]/g, "")}`;
}

export function listExportEntries(
  store: Pick<VaultStore, "get" | "pageExtList">,
  keys: string[],
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
      items.push({ name: entryName(meta, page, ext), key, page });
    }
  }
  return { items, skipped };
}
