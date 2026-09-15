/**
 * 案头报纸：从日榜响应抽出最多 4 张。
 *
 * 作用：DeskNewspaper 与单测共用截断，不把 UI 和 op 判别写两遍。
 */
import type { FetchOk, WorkCard } from "./types.ts";

export function newspaperItems(result: FetchOk | undefined): WorkCard[] {
  if (!result) return [];
  if (result.op === "pixivRanking" || result.op === "booruList") return result.items.slice(0, 4);
  return [];
}
