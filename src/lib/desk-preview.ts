/**
 * 案头「去浏览」预览：从当前站默认流抽出最多 8 张封面。
 *
 * 作用：填满去浏览那张纸；日榜报纸仍走 desk-newspaper，这里用推荐 / 最新 / FANBOX 首页。
 * 用法：previewItems(fetchOk, 8)。
 * 为什么：纯字大卡太空；跟报纸错开数据源，避免两排同一张日榜。
 */
import type { FetchOk, WorkCard } from "./types.ts";

export const DESK_PREVIEW_LIMIT = 8;

export function previewItems(result: FetchOk | undefined, limit = DESK_PREVIEW_LIMIT): WorkCard[] {
  if (!result) return [];
  switch (result.op) {
    case "pixivRecommend":
    case "pixivRanking":
    case "pixivFollowing":
    case "booruList":
    case "fanboxHome":
    case "fanboxCreator":
    case "fanboxSupporting":
      return result.items.filter((item) => Boolean(item.thumb)).slice(0, limit);
    default:
      return [];
  }
}
