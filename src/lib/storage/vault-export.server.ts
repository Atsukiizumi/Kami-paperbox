/**
 * 纸匣导出（E）：条目 → zip 内路径的纯映射。
 *
 * 作用：把 keys 解析成可打包条目（有文件的）与跳过清单（缺条目/无文件）。
 * 为什么拆纯函数：分组逻辑可单测；zip 流本身信任 fflate。
 */
import type { VaultStore } from "./vault-store.server.ts";

export const EXPORT_MAX_KEYS = 400;

export type ExportEntry = { name: string; key: string; page: number; bytes: Uint8Array };
export type ExportSkip = { key: string; reason: "missing" | "no-file" | "read-error" };

function safeSeg(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "x";
}

/** 文件夹名：作者（空则 unknown）；文件名：标题_source_id_p页.ext。 */
export function entryName(
  meta: { author: string; title: string; source: string; id: string },
  page: number,
  ext: string,
): string {
  const author = safeSeg(meta.author || "unknown");
  const base = `${safeSeg(meta.title || meta.id)}_${meta.source}_${safeSeg(meta.id)}_p${page}`;
  return `${author}/${base}.${(ext || "jpg").replace(/[^a-z0-9]/g, "")}`;
}

export function buildExportEntries(
  store: Pick<VaultStore, "get" | "readPage">,
  keys: string[],
): { entries: ExportEntry[]; skipped: ExportSkip[] } {
  const entries: ExportEntry[] = [];
  const skipped: ExportSkip[] = [];
  for (const key of keys) {
    const meta = store.get(key);
    if (!meta) {
      skipped.push({ key, reason: "missing" });
      continue;
    }
    const pageCount = Math.max(0, meta.pageCount || 0);
    if (!pageCount) {
      skipped.push({ key, reason: "no-file" });
      continue;
    }
    let broken = false;
    for (let page = 0; page < pageCount; page += 1) {
      const read = store.readPage(key, page);
      if (!read) {
        broken = true;
        continue;
      }
      entries.push({
        name: entryName(meta, page, read.ext),
        key,
        page,
        bytes: new Uint8Array(read.bytes),
      });
    }
    if (broken) skipped.push({ key, reason: "read-error" });
  }
  return { entries, skipped };
}
