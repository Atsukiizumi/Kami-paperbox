/**
 * 纸匣导出（E）：条目 → zip 内路径的纯映射。
 *
 * 作用：把 keys 解析成待打包清单（文件名/键/页码元数据）与跳过清单。
 * 为什么只出元数据不带字节（评审 #130）：字节必须在流式 pull 里逐页读——
 * 预读全部页会把整个包堆进内存，与「不整包进内存」的 spec 相悖。
 * 分夹名走 author-name 规范化 + 用户别名：同一画师的装饰名变体不再各开一夹
 * （别名表由客户端随请求带上，服务端保持无状态）。
 */
import type { VaultStore } from "./vault-store.server.ts";
import { entryName, EXPORT_MAX_KEYS } from "./vault-export-plan.ts";

export { entryName, EXPORT_MAX_KEYS };

export type ExportItem = { name: string; key: string; page: number };
export type ExportSkip = { key: string; reason: "missing" | "no-file" | "read-error" };

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
