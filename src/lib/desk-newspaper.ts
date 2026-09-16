/**
 * 案头报纸：从日榜响应抽出整页，以及最多 4 张封面。
 *
 * 作用：DeskNewspaper 与单测共用 op 判别；UI 截 4 张，归档写整页。
 * 用法：newspaperItems 画报纸；rankingPageItems 交给 rememberRanking。
 */
import type { FetchOk, WorkCard } from "./types.ts";

export function rankingPageItems(result: FetchOk | undefined): WorkCard[] {
  if (!result) return [];
  if (result.op === "pixivRanking" || result.op === "booruList") return result.items;
  return [];
}

export function newspaperItems(result: FetchOk | undefined): WorkCard[] {
  return rankingPageItems(result).slice(0, 4);
}
