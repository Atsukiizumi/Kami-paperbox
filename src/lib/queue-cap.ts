/**
 * 队列容量。
 *
 * 作用：入队时套用 localStorage 上限，并算出这次实际留下 / 没排进的张数。
 * 用法：store.enqueue 走 applyEnqueue；enqueueWorks 走 applyEnqueueMany。
 * 为什么：批量上限曾经写成 200，队列却只留 80，多出来的被静默丢掉，提示仍报全部张数。
 */
import { BATCH_MAX } from "./batch-collect.ts";
import type { QueueItem, QueueKind } from "./types.ts";

export type EnqueueTally = { kept: number; dropped: number };

export type QueueDraft = Omit<QueueItem, "status" | "progress" | "total" | "addedAt" | "error">;

/** 单条入队，语义与原先 store.enqueue 一致：进行中的不重复占位，新的排到最前，超出 BATCH_MAX 的从末尾丢掉。 */
export function applyEnqueue(items: QueueItem[], item: QueueDraft, now: number): QueueItem[] {
  const live = items.find((x) => x.key === item.key && (x.status === "queued" || x.status === "running"));
  if (live) {
    if (item.kind === "download" && live.kind !== "download") {
      return items.map((x) => (x.key === item.key ? { ...x, kind: "download" as const } : x));
    }
    return items;
  }
  const next: QueueItem = {
    ...item,
    kind: item.kind === "vault" ? "vault" : "download",
    status: "queued",
    progress: 0,
    total: 1,
    addedAt: now,
    error: undefined,
  };
  return [next, ...items.filter((x) => x.key !== item.key)].slice(0, BATCH_MAX);
}

/** 按调用顺序逐条套用 applyEnqueue，再按请求里的 key 统计留下与没排进的张数（重复 key 只计一次）。 */
export function applyEnqueueMany(
  items: QueueItem[],
  incoming: QueueDraft[],
  now: number,
): { items: QueueItem[]; tally: EnqueueTally } {
  let next = items;
  for (const item of incoming) next = applyEnqueue(next, item, now);
  const present = new Set(next.map((x) => x.key));
  const seen = new Set<string>();
  let kept = 0;
  let dropped = 0;
  for (const item of incoming) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    if (present.has(item.key)) kept += 1;
    else dropped += 1;
  }
  return { items: next, tally: { kept, dropped } };
}

/** 画师页 / 创作者页的入队提示。没超出时句子与原来一致。 */
export function formatBatchEnqueueToast(kind: QueueKind, tally: EnqueueTally, skipped: string[]): string {
  const head = kind === "vault" ? "已入队：纸匣" : "已入队：下载";
  const notes: string[] = [];
  if (tally.dropped > 0) notes.push(`队列只保留 ${BATCH_MAX} 张，这次有 ${tally.dropped} 张没排进去`);
  if (skipped.length > 0) notes.push(`跳过 ${skipped.join("、")}`);
  const tail = notes.length > 0 ? `（${notes.join("；")}）` : "";
  return `${head} ${tally.kept} 张${tail}`;
}

/** 合集页的入队提示。没超出时句子与原来一致。 */
export function formatPoolEnqueueToast(kind: QueueKind, tally: EnqueueTally): string {
  const head = kind === "vault" ? "已加入队列：收入纸匣" : "已加入队列：下载合集";
  const note = tally.dropped > 0 ? `（队列只保留 ${BATCH_MAX} 张，这次有 ${tally.dropped} 张没排进去）` : "";
  return `${head} ${tally.kept} 张${note}`;
}
