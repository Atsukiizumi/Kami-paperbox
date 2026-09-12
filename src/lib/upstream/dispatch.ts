/**
 * 上游分发器：把 FetchInput 路由到各站点适配（由 upstream.server.ts 拆出，TD-01）。
 * 签名与行为不变——上层（/api/source、source-cache）零改动。
 */
import { fanboxCookieHeader, pixivCookieHeader } from "../browser-login.ts";
import type { FetchInput, FetchOk } from "../types.ts";
import { booruList, booruPool, booruPost, tagSuggest, type BooruAuth } from "./booru-sites.ts";
import { fanboxCreator, fanboxFeedList, fanboxPost, fanboxTagged } from "./fanbox.ts";
import {
  pixivFollowing,
  pixivIllust,
  pixivMyFollowing,
  pixivRanking,
  pixivRecommend,
  pixivRelated,
  pixivSearch,
  pixivUgoira,
  pixivUser,
} from "./pixiv.ts";

export async function dispatchFetch(input: FetchInput): Promise<FetchOk> {
  const pixiv = pixivCookieHeader(input.pixivCookie);
  const fanbox = fanboxCookieHeader(input.fanboxCookie, input.pixivCookie);
  const safe = input.safeMode !== false;
  const hideAi = input.hideAi === true;
  const booruAuth: BooruAuth = {
    danbooruLogin: input.danbooruLogin?.trim() || undefined,
    danbooruApiKey: input.danbooruApiKey?.trim() || undefined,
  };
  switch (input.op) {
    case "pixivRanking":
      return pixivRanking(input.mode, input.page, pixiv, safe, hideAi, input.date);
    case "pixivSearch":
      return pixivSearch(input.word, input.page, pixiv, safe, hideAi, input.filter);
    case "pixivRecommend":
      return pixivRecommend(pixiv, safe, hideAi);
    case "pixivFollowing":
      return pixivFollowing(input.page, pixiv, safe, hideAi);
    case "pixivMyFollowing":
      return pixivMyFollowing(input.page, pixiv);
    case "pixivRelated":
      return pixivRelated(input.id, pixiv, safe, hideAi);
    case "pixivIllust":
      return pixivIllust(input.id, pixiv, safe);
    case "pixivUgoira":
      return pixivUgoira(input.id, pixiv);
    case "pixivUser":
      return pixivUser(input.id, input.offset ?? 0, pixiv, safe, hideAi);
    case "fanboxCreator":
      return fanboxCreator(input.id, input.cursor, fanbox, safe);
    case "fanboxHome":
      return fanboxFeedList("home", input.cursor, fanbox, safe);
    case "fanboxSupporting":
      return fanboxFeedList("supporting", input.cursor, fanbox, safe);
    case "fanboxPost":
      return fanboxPost(input.id, fanbox, safe);
    case "fanboxTagged":
      return fanboxTagged(input.tag, input.page, fanbox, safe);
    case "booruList":
      return booruList(input.site, input.feed, input.tags ?? "", input.page, safe, input.date, booruAuth);
    case "booruPost":
      return booruPost(input.site, input.id, safe, booruAuth);
    case "booruPool":
      return booruPool(input.site, input.id, safe, booruAuth);
    case "tagSuggest":
      return tagSuggest(input.source, input.word, pixiv, booruAuth);
    default: {
      const _never: never = input;
      throw new Error(`未知操作: ${JSON.stringify(_never)}`);
    }
  }
}
