/**
 * 上游读接口（服务端）。
 *
 * 作用：把 Pixiv `/ajax`、FANBOX `api.fanbox.cc`、图站 JSON 转成纸匣的卡片/作品。
 * 用法：只通过 source.ts 的 fetchSource 进来，UI 不要直接打这些域名。
 * 为什么：浏览器过不了 CORS / pximg Referer；Cookie 和 Origin 必须由服务端带。
 *        接口清单和抓法见 docs/upstream.md、docs/reverse-engineering.md。
 */
import type { UgoiraMeta } from "./ugoira-meta";
import { mapUgoiraMeta } from "./ugoira-meta";
import { socialFromPixivIllust } from "./social";
import {
  collectIllustRecords,
  collectOrderedIds,
  isAiWork,
  isLastFeedPage,
  orderCardsByIds,
  pixivAiType,
  rankingMeta,
  type PixivRankMode,
} from "./pixiv-feed";
import {
  BOORU_ORIGIN,
  DANBOORU_UA,
  booruListUrl,
  booruPostUrl,
  composeBooruTags,
  mapBooruCard,
  mapBooruDetail,
} from "./booru";
import type {
  BooruSite,
  CreatorProfile,
  FanboxCursor,
  FetchInput,
  FetchOk,
  UserProfile,
  WorkCard,
  WorkDetail,
  WorkPage,
} from "./types";
import { outboundFetch } from "./curl-fetch.server";
import { fanboxCookieHeader, pixivCookieHeader, withPixivUserId } from "./browser-login";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MEDIA_HOSTS = new Set([
  "i.pximg.net",
  "s.pximg.net",
  "pixiv.pximg.net",
  "downloads.fanbox.cc",
  "files.yande.re",
  "assets.yande.re",
  "yande.re",
  "konachan.com",
  "konachan.net",
  "cdn.donmai.us",
  "danbooru.donmai.us",
]);

const MEDIA_SUFFIXES = [
  "pximg.net",
  "fanbox.cc",
  "yande.re",
  "konachan.com",
  "konachan.net",
  "donmai.us",
  "saucenao.com",
  "iqdb.org",
  "tineye.com",
];

const MAX_MEDIA_BYTES = 48 * 1024 * 1024;

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  return false;
}

function isPrivateIp(host: string): boolean {
  if (/^127\./.test(host) || host === "0.0.0.0") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

export function parseAllowedMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("无效的图片地址");
  }
  if (url.protocol !== "https:") throw new Error("只允许 https 资源");
  if (url.username || url.password) throw new Error("非法地址");
  const host = url.hostname.toLowerCase();
  if (isPrivateHostname(host) || isPrivateIp(host)) throw new Error("非法地址");
  if (MEDIA_HOSTS.has(host)) return url;
  if (MEDIA_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return url;
  throw new Error("不支持的图片来源");
}

async function upstreamJson(
  url: string,
  opts: { cookie?: string; origin: "pixiv" | "fanbox" },
): Promise<unknown> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  };
  if (opts.origin === "pixiv") {
    headers.Referer = "https://www.pixiv.net/";
    withPixivUserId(headers, opts.cookie);
  } else {
    headers.Referer = "https://www.fanbox.cc/";
    headers.Origin = "https://www.fanbox.cc";
  }
  if (opts.cookie) headers.Cookie = opts.cookie;

  const res = await outboundFetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      opts.origin === "pixiv"
        ? `Pixiv 请求失败（${res.status}）`
        : `FANBOX 请求失败（${res.status}）`,
    );
  }
  return res.json();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function asBool(v: unknown): boolean {
  return v === true;
}

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

function mapPixivCard(item: Record<string, unknown>): WorkCard | null {
  if (alwaysBlockedPixiv(item)) return null;
  const id = asString(item.id || item.illust_id);
  if (!id) return null;
  const tagsRaw = item.tags;
  const tags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    for (const t of tagsRaw) {
      if (typeof t === "string") tags.push(t);
      else if (t && typeof t === "object" && "tag" in t) {
        tags.push(asString((t as { tag: unknown }).tag));
      }
    }
  }
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
    tags: tags.filter(Boolean).slice(0, 12),
    width: asNumber(item.width) || undefined,
    height: asNumber(item.height) || undefined,
    date: asString(item.createDate || item.date) || undefined,
    illustType: asNumber(item.illustType ?? item.illust_type, 0),
    aiType: pixivAiType(item) || undefined,
  };
}

function keepPixivCard(card: WorkCard | null, hideAi: boolean): card is WorkCard {
  if (!card) return false;
  return !(hideAi && isAiWork(card));
}

function mapIllustList(raw: unknown, safeMode: boolean, hideAi = false): WorkCard[] {
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

async function pixivRanking(
  mode: PixivRankMode,
  page: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
): Promise<FetchOk> {
  const meta = rankingMeta(mode);
  if (meta.nsfw && safeMode) {
    throw new Error("已开启安全模式，R-18 榜单被隐藏。可在设置中关闭。");
  }
  if (meta.login && !cookie) {
    throw new Error("需要登录 Pixiv 才能查看该榜单。");
  }
  const url = `https://www.pixiv.net/ranking.php?mode=${mode}&content=illust&p=${page}&format=json`;
  const json = asRecord(await upstreamJson(url, { cookie, origin: "pixiv" }));
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

async function pixivRecommend(cookie?: string, safeMode = true, hideAi = false): Promise<FetchOk> {
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

async function pixivFollowing(
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

async function pixivRelated(id: string, cookie?: string, safeMode = true, hideAi = false): Promise<FetchOk> {
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

async function pixivSearch(
  word: string,
  page: number,
  cookie?: string,
  safeMode = true,
  hideAi = false,
): Promise<FetchOk> {
  const mode = safeMode ? "safe" : "all";
  const encoded = encodeURIComponent(word);
  const ai = hideAi ? "&ai_type=1" : "";
  const url =
    `https://www.pixiv.net/ajax/search/artworks/${encoded}` +
    `?word=${encoded}&order=date_d&mode=${mode}&p=${page}&s_mode=s_tag&type=all${ai}&lang=zh`;
  const json = asRecord(await upstreamJson(url, { cookie, origin: "pixiv" }));
  if (json.error) throw new Error(asString(json.message, "搜索失败"));
  const body = asRecord(json.body);
  const illustManga = asRecord(body.illustManga);
  const data = Array.isArray(illustManga.data) ? illustManga.data : [];
  const items: WorkCard[] = [];
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
    nextPage: items.length >= 20 ? page + 1 : null,
  };
}

function collectPixivTags(raw: unknown): string[] {
  const tags = asRecord(asRecord(raw).tags);
  const list = Array.isArray(tags.tags) ? tags.tags : [];
  const out: string[] = [];
  for (const t of list) {
    const rec = asRecord(t);
    const tag = asString(rec.tag);
    if (tag) out.push(tag);
  }
  return out.slice(0, 24);
}

async function pixivIllust(
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
      });
    }
  }
  if (pages.length === 0) {
    const urls = asRecord(body.urls);
    pages.push({
      thumb: asString(urls.small || urls.thumb),
      regular: asString(urls.regular || urls.small),
      original: asString(urls.original || urls.regular),
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
    tags: collectPixivTags(body.tags),
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

async function pixivUser(
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
  const illusts = asRecord(all.illusts);
  const manga = asRecord(all.manga);
  const ids = [...Object.keys(illusts), ...Object.keys(manga)].filter((k) => /^\d+$/.test(k));
  const slice = ids.slice(offset, offset + 60);
  let items: WorkCard[] = [];
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
    totalWorks: ids.length,
    isFollowed: asBool(user.isFollowed),
  };
  return { op: "pixivUser", profile, items, total: ids.length, offset };
}

function sizeFromFanboxUrl(url: string): { width?: number; height?: number } {
  const m = url.match(/\/c\/(\d{2,5})x(\d{2,5})(?:[/_]|$)/);
  if (!m) return {};
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 32 || height < 32 || width > 8000 || height > 8000) return {};
  return { width, height };
}

function fanboxCoverOf(raw: Record<string, unknown>): { url: string; width?: number; height?: number } {
  let url = "";
  let width: number | undefined;
  let height: number | undefined;
  const cover = raw.cover;
  if (typeof cover === "string") {
    url = cover;
  } else if (cover && typeof cover === "object") {
    const rec = asRecord(cover);
    url = asString(rec.url || rec.originUrl || rec.thumbnailUrl);
    width = asNumber(rec.width) || undefined;
    height = asNumber(rec.height) || undefined;
  }
  if (!url) url = asString(raw.coverImageUrl || raw.imageForShare);
  if ((!width || !height) && url) {
    const parsed = sizeFromFanboxUrl(url);
    width = width || parsed.width;
    height = height || parsed.height;
  }
  return { url, width, height };
}

function pushFanboxImage(pages: WorkPage[], raw: Record<string, unknown>) {
  const original = asString(raw.originalUrl || raw.url);
  if (!original) return;
  const name = asString(raw.id);
  const ext = asString(raw.extension, "jpg");
  pages.push({
    thumb: asString(raw.thumbnailUrl || original),
    regular: original,
    original,
    name: name ? `${name}.${ext}` : undefined,
  });
}

function pushFanboxFile(pages: WorkPage[], raw: Record<string, unknown>) {
  const url = asString(raw.url);
  if (!url) return;
  pages.push({
    thumb: url,
    regular: url,
    original: url,
    name: asString(raw.name, "file"),
    bytes: asNumber(raw.size) || undefined,
  });
}

function mapFanboxPostCard(raw: Record<string, unknown>): WorkCard | null {
  const id = asString(raw.id);
  if (!id) return null;
  const user = asRecord(raw.user);
  const cover = fanboxCoverOf(raw);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : [];
  const excerpt = asString(raw.excerpt).replace(/<[^>]+>/g, "").slice(0, 280);
  return {
    source: "fanbox",
    id,
    title: asString(raw.title),
    author: asString(user.name),
    authorId: asString(raw.creatorId || user.userId),
    thumb: cover.url,
    pageCount: 1,
    tags,
    width: cover.width,
    height: cover.height,
    restricted: asBool(raw.isRestricted),
    feeRequired: asNumber(raw.feeRequired, 0),
    date: asString(raw.publishedDatetime) || undefined,
    excerpt: excerpt || undefined,
  };
}

function extractFanboxPages(post: Record<string, unknown>): WorkPage[] {
  const pages: WorkPage[] = [];
  const seen = new Set<string>();
  const add = (page: WorkPage) => {
    if (!page.original || seen.has(page.original)) return;
    seen.add(page.original);
    pages.push(page);
  };
  const addImage = (raw: Record<string, unknown>) => {
    const buf: WorkPage[] = [];
    pushFanboxImage(buf, raw);
    for (const p of buf) add(p);
  };
  const addFile = (raw: Record<string, unknown>) => {
    const buf: WorkPage[] = [];
    pushFanboxFile(buf, raw);
    for (const p of buf) add(p);
  };

  const body = asRecord(post.body);
  const imageMap = asRecord(body.imageMap);
  const fileMap = asRecord(body.fileMap);
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (blocks.length > 0) {
    for (const raw of blocks) {
      const rec = asRecord(raw);
      const type = asString(rec.type);
      if (type === "image") addImage(asRecord(imageMap[asString(rec.imageId)]));
      else if (type === "file") addFile(asRecord(fileMap[asString(rec.fileId)]));
    }
  }
  if (pages.length === 0) {
    for (const value of Object.values(imageMap)) addImage(asRecord(value));
    const images = Array.isArray(body.images) ? body.images : [];
    for (const value of images) addImage(asRecord(value));
    for (const value of Object.values(fileMap)) addFile(asRecord(value));
    const files = Array.isArray(body.files) ? body.files : [];
    for (const value of files) addFile(asRecord(value));
  }
  if (pages.length === 0) {
    const cover = fanboxCoverOf(post);
    if (cover.url) {
      add({ thumb: cover.url, regular: cover.url, original: cover.url });
    }
  }
  return pages;
}

async function fanboxCreator(
  id: string,
  cursor: FanboxCursor | undefined,
  cookie?: string,
  safeMode = true,
): Promise<FetchOk> {
  const creatorQs = new URLSearchParams({ creatorId: id });
  const postsQs = new URLSearchParams({
    creatorId: id,
    limit: "10",
    sort: "newest",
  });
  if (cursor?.datetime) postsQs.set("firstPublishedDatetime", cursor.datetime);
  if (cursor?.id) postsQs.set("firstId", cursor.id);

  const [creatorJson, postsJson] = await Promise.all([
    upstreamJson(`https://api.fanbox.cc/creator.get?${creatorQs}`, {
      cookie,
      origin: "fanbox",
    }),
    upstreamJson(`https://api.fanbox.cc/post.listCreator?${postsQs}`, {
      cookie,
      origin: "fanbox",
    }),
  ]);
  const creatorBody = asRecord(asRecord(creatorJson).body);
  if (!asString(creatorBody.creatorId || asRecord(creatorBody.user).name)) {
    throw new Error("找不到该创作者");
  }
  if (safeMode && asBool(creatorBody.hasAdultContent) && !cookie) {
    // still list, filter posts below
  }
  const user = asRecord(creatorBody.user);
  const profile: CreatorProfile = {
    id: asString(creatorBody.creatorId || id),
    name: asString(user.name),
    avatar: asString(user.iconUrl),
    description: asString(creatorBody.description).replace(/<[^>]+>/g, ""),
    cover: asString(creatorBody.coverImageUrl) || undefined,
    isSupported: asBool(creatorBody.isSupported),
    isFollowed: asBool(creatorBody.isFollowed),
    hasAdultContent: asBool(creatorBody.hasAdultContent),
  };
  const listBody = asRecord(asRecord(postsJson).body);
  const posts = Array.isArray(listBody.items)
    ? listBody.items
    : Array.isArray(listBody.posts)
      ? listBody.posts
      : [];
  const items: WorkCard[] = [];
  for (const raw of posts) {
    const rec = asRecord(raw);
    if (safeMode && asBool(rec.hasAdultContent)) continue;
    const card = mapFanboxPostCard(rec);
    if (card) items.push(card);
  }
  const last = posts.length > 0 ? asRecord(posts[posts.length - 1]) : null;
  const nextCursor: FanboxCursor | null =
    last && posts.length >= 10
      ? {
          datetime: asString(last.publishedDatetime).replace("T", " ").replace(/\+.*$/, ""),
          id: asString(last.id),
        }
      : null;
  return { op: "fanboxCreator", profile, items, cursor: nextCursor };
}

async function fanboxPost(
  id: string,
  cookie?: string,
  safeMode = true,
): Promise<FetchOk> {
  const json = await upstreamJson(`https://api.fanbox.cc/post.info?postId=${id}`, {
    cookie,
    origin: "fanbox",
  });
  const root = asRecord(json);
  const nested = asRecord(root.body);
  const post = asRecord(nested.post && typeof nested.post === "object" ? nested.post : nested);
  if (!asString(post.id)) throw new Error("投稿不存在或需要登录");
  if (safeMode && asBool(post.hasAdultContent)) {
    throw new Error("已开启安全模式，成人内容被隐藏。可在设置中关闭。");
  }
  const user = asRecord(post.user);
  const restricted = asBool(post.isRestricted);
  const pages = restricted ? [] : extractFanboxPages(post);
  const cover = asString(post.coverImageUrl) || fanboxCoverOf(post).url;
  const work: WorkDetail = {
    source: "fanbox",
    id: asString(post.id || id),
    title: asString(post.title),
    author: asString(user.name),
    authorId: asString(post.creatorId || user.userId),
    thumb: cover || pages[0]?.thumb || "",
    pageCount: pages.length || 1,
    tags: Array.isArray(post.tags)
      ? post.tags.filter((t): t is string => typeof t === "string")
      : [],
    restricted,
    feeRequired: asNumber(post.feeRequired, 0),
    date: asString(post.publishedDatetime) || undefined,
    description: asString(post.excerpt || post.body).replace(/<[^>]+>/g, ""),
    excerpt: asString(post.excerpt) || undefined,
    pages,
    liked: asBool(post.isLiked),
    followed: asBool(post.isFollowed),
  };
  if (typeof post.body === "object" && post.body) {
    const blocks = asRecord(post.body).blocks;
    if (Array.isArray(blocks)) {
      const text = blocks
        .map((b) => asString(asRecord(b).text))
        .filter(Boolean)
        .join("\n");
      if (text) work.description = text.slice(0, 4000);
    }
  }
  return { op: "fanboxPost", work };
}

function mapFanboxItems(posts: unknown[], safeMode: boolean): WorkCard[] {
  const items: WorkCard[] = [];
  for (const raw of posts) {
    const rec = asRecord(raw);
    if (safeMode && asBool(rec.hasAdultContent)) continue;
    const card = mapFanboxPostCard(rec);
    if (card) items.push(card);
  }
  return items;
}

function nextFanboxCursor(posts: unknown[]): FanboxCursor | null {
  if (posts.length < 10) return null;
  const last = asRecord(posts[posts.length - 1]);
  const datetime = asString(last.publishedDatetime).replace("T", " ").replace(/\+.*$/, "");
  const id = asString(last.id);
  if (!datetime || !id) return null;
  return { datetime, id };
}

async function fanboxTagged(tag: string, page: number, cookie?: string, safeMode = true): Promise<FetchOk> {
  const qs = new URLSearchParams({ tag, limit: "20" });
  if (page > 1) qs.set("page", String(page));
  const json = await upstreamJson(`https://api.fanbox.cc/post.listTagged?${qs}`, {
    cookie,
    origin: "fanbox",
  });
  const body = asRecord(asRecord(json).body);
  const posts = Array.isArray(body.items) ? body.items : [];
  const items = mapFanboxItems(posts, safeMode);
  return { op: "fanboxTagged", items, nextPage: posts.length >= 20 ? page + 1 : null };
}

async function fanboxFeedList(
  kind: "home" | "supporting",
  cursor: FanboxCursor | undefined,
  cookie?: string,
  safeMode = true,
): Promise<FetchOk> {
  if (!cookie) throw new Error("需要登录 FANBOX 才能看订阅动态。");
  const qs = new URLSearchParams({ limit: "10" });
  if (cursor?.datetime) qs.set("maxPublishedDatetime", cursor.datetime);
  if (cursor?.id) qs.set("maxId", cursor.id);
  const path = kind === "home" ? "post.listHome" : "post.listSupporting";
  const json = await upstreamJson(`https://api.fanbox.cc/${path}?${qs}`, {
    cookie,
    origin: "fanbox",
  });
  const listBody = asRecord(asRecord(json).body);
  const posts = Array.isArray(listBody.items)
    ? listBody.items
    : Array.isArray(listBody.posts)
      ? listBody.posts
      : [];
  const items = mapFanboxItems(posts, safeMode);
  const op = kind === "home" ? "fanboxHome" : "fanboxSupporting";
  return { op, items, cursor: nextFanboxCursor(posts) };
}

async function booruJson(site: BooruSite, url: string): Promise<unknown> {
  const origin = BOORU_ORIGIN[site];
  const headers: Record<string, string> = {
    "User-Agent": site === "danbooru" ? DANBOORU_UA : UA,
    Accept: "application/json,text/plain,*/*",
    Referer: `${origin}/`,
  };
  if (site === "danbooru") {
    const { curlFetch } = await import("./curl-fetch.server");
    const res = await curlFetch(url, headers);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Danbooru 请求失败（${res.status}）`);
    }
    const text = res.body.toString("utf8");
    if (text.trimStart().startsWith("<")) throw new Error("源站暂时拒绝访问，请稍后再试");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("源站返回了无法解析的数据");
    }
  }
  const res = await outboundFetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      site === "yande" ? `Yande 请求失败（${res.status}）` : `${site} 请求失败（${res.status}）`,
    );
  }
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("源站暂时拒绝访问，请稍后再试");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("源站返回了无法解析的数据");
  }
}

function asBooruPosts(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.map(asRecord);
  const rec = asRecord(json);
  if (rec.success === false || rec.error) {
    throw new Error(asString(rec.message || rec.error, "检索失败"));
  }
  if (Array.isArray(rec.posts)) return rec.posts.map(asRecord);
  if (asString(rec.id)) return [rec];
  return [];
}

async function booruList(
  site: BooruSite,
  feed: "recent" | "popular",
  tags: string,
  page: number,
  safeMode: boolean,
): Promise<FetchOk> {
  const composed = composeBooruTags(site, tags, safeMode);
  const json = await booruJson(site, booruListUrl(site, feed, composed, page));
  const items: WorkCard[] = [];
  for (const rec of asBooruPosts(json)) {
    const card = mapBooruCard(site, rec, safeMode);
    if (card) items.push(card);
  }
  const canPage = !(feed === "popular" && site !== "danbooru");
  return {
    op: "booruList",
    site,
    items,
    nextPage: canPage && items.length >= 8 ? page + 1 : null,
  };
}

async function booruPost(site: BooruSite, id: string, safeMode: boolean): Promise<FetchOk> {
  const json = await booruJson(site, booruPostUrl(site, id));
  const rec = asBooruPosts(json)[0];
  if (!rec) throw new Error("作品不存在");
  const work = mapBooruDetail(site, rec, safeMode);
  if (!work) {
    if (mapBooruDetail(site, rec, false)) {
      throw new Error("已关闭 R-18，该作品被隐藏。可在浏览页打开 R-18。");
    }
    throw new Error("作品不存在，或包含被过滤的内容");
  }
  return { op: "booruPost", work };
}

export async function dispatchFetch(input: FetchInput): Promise<FetchOk> {
  const pixiv = pixivCookieHeader(input.pixivCookie);
  const fanbox = fanboxCookieHeader(input.fanboxCookie, input.pixivCookie);
  const safe = input.safeMode !== false;
  const hideAi = input.hideAi === true;
  switch (input.op) {
    case "pixivRanking":
      return pixivRanking(input.mode, input.page, pixiv, safe, hideAi);
    case "pixivSearch":
      return pixivSearch(input.word, input.page, pixiv, safe, hideAi);
    case "pixivRecommend":
      return pixivRecommend(pixiv, safe, hideAi);
    case "pixivFollowing":
      return pixivFollowing(input.page, pixiv, safe, hideAi);
    case "pixivRelated":
      return pixivRelated(input.id, pixiv, safe, hideAi);
    case "pixivIllust":
      return pixivIllust(input.id, pixiv, safe);
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
      return booruList(input.site, input.feed, input.tags ?? "", input.page, safe);
    case "booruPost":
      return booruPost(input.site, input.id, safe);
    default: {
      const _never: never = input;
      throw new Error(`未知操作: ${JSON.stringify(_never)}`);
    }
  }
}

export async function fetchMediaResponse(
  rawUrl: string,
  cookies: { pixiv?: string; fanbox?: string },
): Promise<Response> {
  const url = parseAllowedMediaUrl(rawUrl);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "image/avif,image/webp,image/gif,image/*,application/zip,application/octet-stream,*/*;q=0.8",
  };
  const host = url.hostname.toLowerCase();
  if (host.endsWith("pximg.net")) {
    headers.Referer = "https://www.pixiv.net/";
    const c = pixivCookieHeader(cookies.pixiv);
    if (c) {
      headers.Cookie = c;
      withPixivUserId(headers, c);
    }
  } else if (host === "yande.re" || host.endsWith(".yande.re")) {
    headers.Referer = "https://yande.re/";
  } else if (host.endsWith("konachan.com") || host.endsWith("konachan.net")) {
    headers.Referer = "https://konachan.com/";
  } else if (host.endsWith("donmai.us")) {
    headers.Referer = "https://danbooru.donmai.us/";
    headers["User-Agent"] = DANBOORU_UA;
    const { curlFetch } = await import("./curl-fetch.server");
    const res = await curlFetch(url.toString(), headers);
    if (res.status < 200 || res.status >= 300) {
      return new Response("upstream error", { status: res.status === 404 ? 404 : 502 });
    }
    if (res.body.byteLength > MAX_MEDIA_BYTES) {
      return new Response("file too large", { status: 413 });
    }
    return new Response(new Uint8Array(res.body), {
      status: 200,
      headers: {
        "Content-Type": res.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } else {
    headers.Referer = "https://www.fanbox.cc/";
    headers.Origin = "https://www.fanbox.cc";
    const c = fanboxCookieHeader(cookies.fanbox, cookies.pixiv);
    if (c) headers.Cookie = c;
  }

  const res = await outboundFetch(url.toString(), { headers, redirect: "follow" });
  if (!res.ok) {
    return new Response("upstream error", { status: res.status === 404 ? 404 : 502 });
  }
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_MEDIA_BYTES) {
    return new Response("file too large", { status: 413 });
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_MEDIA_BYTES) {
    return new Response("file too large", { status: 413 });
  }
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
