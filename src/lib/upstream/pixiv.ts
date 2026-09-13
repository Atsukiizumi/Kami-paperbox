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
import { pixivRankingDateParam } from "../storage/ranking-archive.ts";
import { jstYesterdayCompact } from "../storage/ranking-archive.ts";

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

/**
 * 榜单入口：没指定日期且当天榜未公布（报错或空）时，自动回落到昨天
 * （JST）——用户要看的永远是「最新已公布的那一期」。
 */
/**
 * 「未公布窗口内」的 404：日期不早于 JST 日历昨天、且上游回 404。
 * pixiv 日榜公布晚于 JST 午夜——窗口内连日历昨天都会 404（2026-09-11 实测：
 * JST 09-12 00:39 时 0911 仍未公布）。这种 404 视同「未公布」走回落；
 * 更早的历史日期 404 是真异常，如实抛出。
 */
export function isUnpublishedWindow404(date: string | undefined, message: string, now = new Date()): boolean {
  return Boolean(date) && date! >= jstYesterdayCompact(now) && /（404）/.test(message);
}

// PER-12：未公布日期的进程内短记忆——窗口内同一 (mode,date) 的后续请求
// 跳过原始日期直打回落，省掉「原始→昨天→无日期」的连环回源放大。
// 10 分钟足够覆盖公布窗口；成功拿到内容即清除（下一请求恢复正常路径）。
const UNPUBLISHED_MEMO_MS = 10 * 60_000;
const unpublishedMemo = new Map<string, number>();

function unpublishedRecently(mode: PixivRankMode, date: string): boolean {
  const at = unpublishedMemo.get(`${mode}:${date}`);
  return typeof at === "number" && Date.now() - at < UNPUBLISHED_MEMO_MS;
}

function noteUnpublished(mode: PixivRankMode, date: string): void {
  unpublishedMemo.set(`${mode}:${date}`, Date.now());
}

export async function pixivRanking(
  mode: PixivRankMode,
  page: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
  rawDate?: string,
): Promise<FetchOk> {
  // 今天/未来的日榜必然 404（公布前当天参数打 pixiv 直接 404）。浏览页的
  // pixivRankingDateParam 是第一道清洗，这里兜底：任何路径把今天/未来传
  // 进来都视同「没指定日期」，走最新已公布回落——历史日期原样尊重。
  const date = rawDate ? pixivRankingDateParam(rawDate) : undefined;
  let first: FetchOk | null = null;
  let unpublished = false;
  if (date && unpublishedRecently(mode, date)) {
    unpublished = true; // 窗口内已知未公布：不再付一次注定 404/空的原始请求
  } else {
    try {
      first = await loadPixivRanking(mode, page, cookie, safeMode, hideAi, date);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // 「未公布」类失败才回落：显式报错文案，或昨天/更新的日期打 404
      // （pixiv 的公布晚于 JST 午夜——公布窗口内日历昨天也 404，2026-09-11 实测）。
      // 更早的历史日期 404 视为真异常；登录 / 网络问题如实抛出。
      const unpublished404 = isUnpublishedWindow404(date, message);
      const unpublishedMsg = page === 1 && /还没公布|没有内容/.test(message);
      // 窗口内 404 任意页码都回落（第 1 页回落后第 2 页必须打同一目标，列表才连贯）
      if (!unpublishedMsg && !unpublished404) throw err;
      unpublished = true;
      if (date) noteUnpublished(mode, date);
    }
  }
  // 只在第一页时回落；「日历昨天」可能仍未公布，回落首选无日期——pixiv 自己
  // 返回最新已公布一期并带官方 date，任何时刻都有效。
  const emptyToday =
    page === 1 &&
    !unpublished &&
    first !== null &&
    first.op === "pixivRanking" &&
    first.items.length === 0;
  if (!unpublished && !emptyToday && first !== null) {
    if (date && first.op === "pixivRanking" && first.items.length > 0) unpublishedMemo.delete(`${mode}:${date}`);
    return first;
  }
  if (!unpublished && emptyToday && date) noteUnpublished(mode, date);

  if (!date) {
    // 无日期请求未公布/为空（罕见）：再试昨天作最后兜底
    const yesterday = jstYesterdayCompact();
    try {
      const result = await loadPixivRanking(mode, page, cookie, safeMode, hideAi, yesterday);
      if (result.op === "pixivRanking" && !result.date) {
        return { ...result, date: yesterday };
      }
      return result;
    } catch {
      // 昨天也没公布——把原始失败抛出去
    }
  }
  return await loadPixivRanking(mode, page, cookie, safeMode, hideAi, undefined);
}

async function loadPixivRanking(
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

/** ajax/my/following 响应 → 画师名单（纯映射，可测）。 */
export function mapMyFollowing(json: unknown, offset: number): { items: { id: string; name: string; avatar: string }[]; nextPage: number | null } {
  const root = asRecord(json);
  if (root.error) throw new Error(asString(root.message, "关注列表加载失败，请确认 Cookie 仍然有效"));
  const body = asRecord(root.body);
  const users = Array.isArray(body.users) ? body.users : [];
  const items = users
    .map((raw) => {
      const u = asRecord(raw);
      const id = asString(u.userId);
      if (!id) return null;
      return {
        id,
        name: asString(u.userName),
        avatar: asString(u.profileImageUrl).startsWith("http") ? asString(u.profileImageUrl) : "",
      };
    })
    .filter((u): u is { id: string; name: string; avatar: string } => u !== null);
  const total = asNumber(body.total, offset + items.length);
  const nextPage = offset + items.length < total ? Math.floor(offset / 24) + 2 : null;
  return { items, nextPage };
}

export async function pixivMyFollowing(
  page: number,
  cookie?: string,
): Promise<FetchOk> {
  // 追踪导入用：自己的关注画师分页名单（每页 24，与官方一致）。
  if (!cookie) throw new Error("需要登录 Pixiv 才能读关注列表。");
  const offset = (page - 1) * 24;
  const json = await upstreamJson(
    `https://www.pixiv.net/ajax/my/following?offset=${offset}&limit=24&lang=zh`,
    { cookie, origin: "pixiv" },
  );
  const { items, nextPage } = mapMyFollowing(json, offset);
  return { op: "pixivMyFollowing", items, nextPage };
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
