/**
 * 纸匣未读（案头纸叠）。
 *
 * 作用：藏品在 90 天浏览历史窗内、且收下之后没打开过，算未读。
 * 用法：unreadItems(listVault(), useViewHistory.getState().items)。
 * 为什么：不往 VaultMeta 加 openedAt；历史超过 90 天已剪枝，更早的当未知。
 */
import type { VaultMeta } from "./types.ts";
import { historyCutoff, type HistoryEntry } from "./view-history.ts";

export function workKey(source: string, id: string): string {
  return `${source}:${id}`;
}

export function unreadItems(
  vault: readonly VaultMeta[],
  history: readonly HistoryEntry[],
  now = Date.now(),
): VaultMeta[] {
  const cut = historyCutoff(now);
  const viewed = new Map<string, number>();
  for (const row of history) viewed.set(workKey(row.source, row.id), row.viewedAt);
  return vault.filter((item) => {
    if (item.savedAt < cut) return false;
    const seen = viewed.get(workKey(item.source, item.id));
    return seen === undefined || seen < item.savedAt;
  });
}
