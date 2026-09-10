/**
 * Pixiv 站点适配：榜单 / 推荐 / 关注 / 相关 / 搜索 / 详情 / 动图 / 画师
 * （由 upstream.server.ts 拆出，TD-01）。
 */
import type { UgoiraMeta } from "../ugoira-meta.ts";
import { mapUgoiraMeta } from "../ugoira-meta.ts";
import { socialFromPixivIllust } from "../social.ts";
import {
  collectIllustRecords,
  collectOrderedIds,
  collectPixivTags,
  isAiWork,
  isLastFeedPage,
  orderCardsByIds,
  pixivAiType,
  rankingMeta,
  type PixivRankMode,
} from "../pixiv-feed.ts";
import { buildPixivSearchUrl, parsePixivSearchFilter, type PixivSearchFilter } from "../pixiv-search.ts";
import { pixivIdsNewestFirst, pixivPickupItems } from "../pixiv-profile.ts";
import type { FetchOk, UserProfile, WorkCard, WorkDetail, WorkPage } from "../types.ts";
import { asBool, asNumber, asRecord, asString, upstreamJson } from "./http.ts";

function alwaysBlockedPixiv(item: Record<string, unknown>): boolean {
  if (asBool(item.isMasked) || asBool(item.is_masked)) return true;
  const ctype = asRecord(item.illust_content_type);
  if (asBool(ctype.lo)) return true;
  return false;
}

function nsfwPixiv(item: Record<string, unknown>): boolean {
  if (asNumber(item.xRestrict, 0) > 0) return true;
  if (asNumber(item.sl, 0) >= 4) return true;
  const ctype = asRecord(item.illust_content_type);
  if (asNumber(ctype.sexual, 0) > 0) return true;
  return false;
}

export function mapPixivCard(item: Record<string, unknown>): WorkCard | null {
  if (alwaysBlockedPixiv(item)) return null;
  const id = asString(item.id || item.illust_id);
  if (!id) return null;
  const social = socialFromPixivIllust(item);
  return {
    source: "pixiv",
    id,
    title: asString(item.title),
    author: asString(item.userName || item.user_name),
    authorId: asString(item.userId || item.user_id),
    thumb: asString(
      item.url || asRecord(item.urls).thumb || asRecord(item.urls).small || asRecord(item.urls).regular,
    ),
    pageCount: asNumber(item.pageCount || item.illust_page_count, 1),
    tags: collectPixivTags(item.tags ?? item).slice(0, 12),
    width: asNumber(item.width) || undefined,
    height: asNumber(item.height) || undefined,
    date: asString(item.createDate || item.date) || undefined,
    illustType: asNumber(item.illustType ?? item.illust_type, 0),
    aiType: pixivAiType(item) || undefined,
    liked: social.liked || social.bookmarked || undefined,
    bookmarked: social.bookmarked || undefined,
  };
}

function keepPixivCard(card: WorkCard | null, hideAi: boolean): card is WorkCard {
  if (!card) return false;
  return !(hideAi && isAiWork(card));
}

export function mapIllustList(raw: unknown, safeMode: boolean, hideAi = false): WorkCard[] {
  const records = collectIllustRecords(raw);
  const ids = collectOrderedIds(raw);
  const items: WorkCard[] = [];
  for (const rec of records) {
    if (asString(rec.id).startsWith("ad")) continue;
    if (safeMode && nsfwPixiv(rec)) continue;
    const card = mapPixivCard(rec);
    if (keepPixivCard(card, hideAi)) items.push(card);
  }
  return orderCardsByIds(items, ids);
}

export async function pixivRanking(
  mode: PixivRankMode,
  page: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
  date?: string,
): Promise<FetchOk> {
  const meta = rankingMeta(mode);
  if (meta.nsfw && safeMode) {
    throw new Error("已开启安全模式，R-18 榜单被隐藏。可在设置中关闭。");
  }
  if (meta.login && !cookie) {
    throw new Error("需要登录 Pixiv 才能查看该榜单。");
  }
  const qs = new URLSearchParams({ mode, content: "illust", p: String(page), format: "json" });
  if (date && /^\d{8}$/.test(date)) qs.set("date", date);
  const url = `https://www.pixiv.net/ranking.php?${qs}`;
  const json = asRecord(await upstreamJson(url, { cookie, origin: "pixiv" }));
  if (json.error === true || json.error === "true") {
    throw new Error(asString(json.message, "Pixiv 榜单还没公布这一天"));
  }
  const contents = Array.isArray(json.contents) ? json.contents : [];
  const items: WorkCard[] = [];
  for (const raw of contents) {
    const rec = asRecord(raw);
    if (safeMode && !meta.nsfw && nsfwPixiv(rec)) continue;
    const card = mapPixivCard({
      ...rec,
      id: rec.illust_id,
      userName: rec.user_name,
      userId: rec.user_id,
    });
    if (keepPixivCard(card, hideAi)) items.push(card);
  }
  const next = asNumber(json.next, 0);
  return {
    op: "pixivRanking",
    date: asString(json.date),
    items,
    nextPage: next > 0 ? next : null,
  };
}

export async function pixivRecommend(cookie?: string, safeMode = true, hideAi = false): Promise<FetchOk> {
  if (!cookie) throw new Error("需要登录 Pixiv 才能看为你推荐。");
  const mode = safeMode ? "safe" : "all";
  const json = await upstreamJson(
    `https://www.pixiv.net/ajax/discovery/artworks?mode=${mode}&limit=60&lang=zh`,
    { cookie, origin: "pixiv" },
  );
  const root = asRecord(json);
  if (root.error) throw new Error(asString(root.message, "推荐加载失败，请确认 Cookie 仍然有效"));
  return { op: "pixivRecommend", items: mapIllustList(json, safeMode, hideAi), nextPage: null };
}

export async function pixivFollowing(
  page: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
): Promise<FetchOk> {
  if (!cookie) throw new Error("需要登录 Pixiv 才能看关注动态。");
  const mode = safeMode ? "safe" : "all";
  const json = await upstreamJson(
    `https://www.pixiv.net/ajax/follow_latest/illust?mode=${mode}&p=${page}&lang=zh`,
    { cookie, origin: "pixiv" },
  );
  const root = asRecord(json);
  if (root.error) throw new Error(asString(root.message, "关注动态加载失败，请确认 Cookie 仍然有效"));
  const items = mapIllustList(json, safeMode, hideAi);
  const last = isLastFeedPage(json, items.length);
  return { op: "pixivFollowing", items, nextPage: last ? null : page + 1 };
}

export async function pixivRelated(id: string, cookie?: string, safeMode = true, hideAi = false): Promise<FetchOk> {
  try {
    const json = await upstreamJson(
      `https://www.pixiv.net/ajax/illust/${id}/recommend/init?limit=18&lang=zh`,
      { cookie, origin: "pixiv" },
    );
    const root = asRecord(json);
    if (root.error) return { op: "pixivRelated", items: [] };
    return { op: "pixivRelated", items: mapIllustList(json, safeMode, hideAi).slice(0, 12) };
  } catch {
    return { op: "pixivRelated", items: [] };
  }
}

export async function pixivSearch(
  word: string,
  page: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
  filter?: Partial<PixivSearchFilter>,
): Promise<FetchOk> {
  const parsed = parsePixivSearchFilter(filter);
  const url = buildPixivSearchUrl(word, page, parsed, { safeMode, hideAi });
  const json = asRecord(await upstreamJson(url, { cookie, origin: "pixiv" }));
  if (json.error) throw new Error(asString(json.message, "搜索失败"));
  const body = asRecord(json.body);
  const illustManga = asRecord(body.illustManga);
  const data = Array.isArray(illustManga.data) ? illustManga.data : [];
  const items: WorkCard[] = [];
  // TD-12：记过滤前的条数，翻页判断不受 safeMode/hideAi 过滤影响
  for (const raw of data) {
    const rec = asRecord(raw);
    if (asString(rec.id).startsWith("ad")) continue;
    if (safeMode && nsfwPixiv(rec)) continue;
    const card = mapPixivCard(rec);
    if (keepPixivCard(card, hideAi)) items.push(card);
  }
  return {
    op: "pixivSearch",
    items,
    nextPage: data.length >= 20 ? page + 1 : null,
  };
}

export async function pixivIllust(
  id: string,
  cookie?: string,
  safeMode = true,
): Promise<FetchOk> {
  const [infoJson, pagesJson] = await Promise.all([
    upstreamJson(`https://www.pixiv.net/ajax/illust/${id}?lang=zh`, {
      cookie,
      origin: "pixiv",
    }),
    upstreamJson(`https://www.pixiv.net/ajax/illust/${id}/pages?lang=zh`, {
      cookie,
      origin: "pixiv",
    }),
  ]);
  const info = asRecord(infoJson);
  if (info.error) throw new Error(asString(info.message, "作品不存在或需要登录"));
  const body = asRecord(info.body);
  if (alwaysBlockedPixiv(body)) throw new Error("该作品不可用");
  if (safeMode && nsfwPixiv(body)) {
    throw new Error("已开启安全模式，R-18 作品被隐藏。可在设置中关闭。");
  }
  const pageBody = asRecord(pagesJson).body;
  const pages: WorkPage[] = [];
  if (Array.isArray(pageBody)) {
    for (const p of pageBody) {
      const urls = asRecord(asRecord(p).urls);
      pages.push({
        thumb: asString(urls.small || urls.thumb_mini),
        regular: asString(urls.regular),
        original: asString(urls.original || urls.regular),
        width: asNumber(asRecord(p).width) || undefined,
        height: asNumber(asRecord(p).height) || undefined,
      });
    }
  }
  if (pages.length === 0) {
    const urls = asRecord(body.urls);
    pages.push({
      thumb: asString(urls.small || urls.thumb),
      regular: asString(urls.regular || urls.small),
      original: asString(urls.original || urls.regular),
      width: asNumber(body.width) || undefined,
      height: asNumber(body.height) || undefined,
    });
  }
  const work: WorkDetail = {
    source: "pixiv",
    id: asString(body.id || id),
    title: asString(body.title || body.illustTitle),
    author: asString(body.userName),
    authorId: asString(body.userId),
    thumb: pages[0]?.thumb ?? "",
    pageCount: asNumber(body.pageCount, pages.length),
    tags: collectPixivTags(body),
    width: asNumber(body.width) || undefined,
    height: asNumber(body.height) || undefined,
    date: asString(body.createDate) || undefined,
    illustType: asNumber(body.illustType, 0),
    description: asString(body.description).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
    pages,
    views: asNumber(body.viewCount) || undefined,
    bookmarks: asNumber(body.bookmarkCount) || undefined,
    likes: asNumber(body.likeCount) || undefined,
    aiType: asNumber(body.aiType, 0),
    ...socialFromPixivIllust(body),
  };
  const first = work.pages[0];
  if (first && !first.width && work.width) {
    first.width = work.width;
    first.height = work.height;
  }
  if (cookie && work.authorId) {
    try {
      const userJson = await upstreamJson(`https://www.pixiv.net/ajax/user/${work.authorId}?full=1`, {
        cookie,
        origin: "pixiv",
      });
      work.followed = asBool(asRecord(asRecord(userJson).body).isFollowed);
    } catch {
      /* ignore */
    }
  }
  if (work.illustType === 2) {
    try {
      const metaJson = await upstreamJson(
        `https://www.pixiv.net/ajax/illust/${id}/ugoira_meta?lang=zh`,
        { cookie, origin: "pixiv" },
      );
      const meta: UgoiraMeta | null = mapUgoiraMeta(metaJson);
      if (meta) work.ugoira = meta;
    } catch {
      /* ignore */
    }
  }
  return { op: "pixivIllust", work };
}

export async function pixivUgoira(id: string, cookie?: string): Promise<FetchOk> {
  const metaJson = await upstreamJson(`https://www.pixiv.net/ajax/illust/${id}/ugoira_meta?lang=zh`, {
    cookie,
    origin: "pixiv",
  });
  const meta = mapUgoiraMeta(metaJson);
  if (!meta) throw new Error("不是动图");
  return { op: "pixivUgoira", ugoira: meta };
}

export async function pixivUser(
  id: string,
  offset: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
): Promise<FetchOk> {
  const [userJson, allJson] = await Promise.all([
    upstreamJson(`https://www.pixiv.net/ajax/user/${id}?full=1`, {
      cookie,
      origin: "pixiv",
    }),
    upstreamJson(`https://www.pixiv.net/ajax/user/${id}/profile/all`, {
      cookie,
      origin: "pixiv",
    }),
  ]);
  const userWrap = asRecord(userJson);
  if (userWrap.error) throw new Error(asString(userWrap.message, "画师不存在"));
  const user = asRecord(userWrap.body);
  const all = asRecord(asRecord(allJson).body);
  const pickup: WorkCard[] = [];
  const pickupIds = new Set<string>();
  for (const rec of pixivPickupItems(all.pickup)) {
    if (safeMode && nsfwPixiv(rec)) continue;
    const card = mapPixivCard(rec);
    if (!keepPixivCard(card, hideAi)) continue;
    pickup.push(card);
    pickupIds.add(card.id);
  }
  const allIds = pixivIdsNewestFirst(all.illusts, all.manga);
  const newestId = allIds[0];
  const ids = allIds.filter((workId) => !pickupIds.has(workId));
  const slice = ids.slice(offset, offset + 60);
  const items: WorkCard[] = [];
  if (slice.length > 0) {
    const qs = slice.map((i) => `ids[]=${i}`).join("&");
    const worksJson = await upstreamJson(
      `https://www.pixiv.net/ajax/user/${id}/profile/illusts?${qs}&work_category=illust&is_first_page=${offset === 0 ? 1 : 0}`,
      { cookie, origin: "pixiv" },
    );
    const works = asRecord(asRecord(asRecord(worksJson).body).works);
    for (const key of slice) {
      const rec = asRecord(works[key]);
      if (!rec.id) continue;
      if (safeMode && nsfwPixiv(rec)) continue;
      const card = mapPixivCard(rec);
      if (keepPixivCard(card, hideAi)) items.push(card);
    }
  }
  const profile: UserProfile = {
    id: asString(user.userId || id),
    name: asString(user.name),
    avatar: asString(user.imageBig || user.image),
    comment: asString(user.comment),
    following: asNumber(user.following) || undefined,
    totalWorks: ids.length + pickup.length,
    isFollowed: asBool(user.isFollowed),
  };
  return { op: "pixivUser", profile, items, pickup, newestId, total: ids.length + pickup.length, listTotal: ids.length, offset };
}
