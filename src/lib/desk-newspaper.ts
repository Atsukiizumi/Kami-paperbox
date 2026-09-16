/**
 * 案头报纸：从日榜响应抽出整页。
 *
 * 作用：DeskNewspaper 与单测共用 op 判别；UI 走 marquee 用整页（组件侧 cap 30），
 *      归档写整页。
 * 用法：rankingPageItems 抽轨道 / 交给 rememberRanking。
 */
import type { FetchOk, WorkCard } from "./types.ts";

export function rankingPageItems(result: FetchOk | undefined): WorkCard[] {
  if (!result) return [];
  if (result.op === "pixivRanking" || result.op === "booruList") return result.items;
  return [];
}
