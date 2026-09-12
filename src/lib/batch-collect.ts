/**
 * 批量收藏（D）纯函数。
 *
 * 作用：入队前按「已在纸匣 / 已在队列」过滤，返回可入队与跳过计数。
 * 为什么：批量勾选常包含已收藏作品，静默入队会造成重复下载；结果 toast 要给准确计数。
 */
import type { WorkCard } from "./types.ts";

/** 单次批量入队上限：队列在 localStorage（5MB 配额），不放宽。 */
export const BATCH_MAX = 200;

export function workKeyOf(card: Pick<WorkCard, "source" | "id">): string {
  return `${card.source}:${card.id}`;
}

export function filterBatchable(
  cards: WorkCard[],
  state: { inVaultKeys: Set<string>; inQueueKeys: Set<string> },
): { batchable: WorkCard[]; skippedVault: number; skippedQueue: number } {
  let skippedVault = 0;
  let skippedQueue = 0;
  const batchable = cards.filter((card) => {
    if (state.inVaultKeys.has(workKeyOf(card))) {
      skippedVault += 1;
      return false;
    }
    if (state.inQueueKeys.has(workKeyOf(card))) {
      skippedQueue += 1;
      return false;
    }
    return true;
  });
  return { batchable, skippedVault, skippedQueue };
}
