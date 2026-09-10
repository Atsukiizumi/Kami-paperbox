/**
 * FANBOX 站点适配：创作者页 / 投稿详情 / 标签 / 订阅动态
 * （由 upstream.server.ts 拆出，TD-01）。
 */
import { fanboxCursorTime } from "../utils.ts";
import type { CreatorProfile, FanboxCursor, FetchOk, WorkCard, WorkDetail, WorkPage } from "../types.ts";
import { asBool, asNumber, asRecord, asString, upstreamJson } from "./http.ts";

export function sizeFromFanboxUrl(url: string): { width?: number; height?: number } {
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
    width: asNumber(raw.width) || undefined,
    height: asNumber(raw.height) || undefined,
    kind: "image",
  });
}

function pushFanboxFile(pages: WorkPage[], raw: Record<string, unknown>) {
  const url = asString(raw.url);
  if (!url) return;
  const ext = asString(raw.extension).replace(/^\./, "");
  const base = asString(raw.name, "file");
  const named = ext && !base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? `${base}.${ext}` : base;
  pages.push({
    thumb: url,
    regular: url,
    original: url,
    name: named,
    bytes: asNumber(raw.size) || undefined,
    kind: "file",
  });
}

export function mapFanboxPostCard(raw: Record<string, unknown>): WorkCard | null {
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

export function extractFanboxPages(post: Record<string, unknown>): WorkPage[] {
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
      add({
        thumb: cover.url,
        regular: cover.url,
        original: cover.url,
        width: cover.width,
        height: cover.height,
      });
    }
  }
  return pages;
}

export async function fanboxCreator(
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
          datetime: fanboxCursorTime(asString(last.publishedDatetime)),
          id: asString(last.id),
        }
      : null;
  return { op: "fanboxCreator", profile, items, cursor: nextCursor };
}

export async function fanboxPost(
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
  const cover = fanboxCoverOf(post);
  const work: WorkDetail = {
    source: "fanbox",
    id: asString(post.id || id),
    title: asString(post.title),
    author: asString(user.name),
    authorId: asString(post.creatorId || user.userId),
    thumb: cover.url || pages[0]?.thumb || "",
    pageCount: pages.length || 1,
    tags: Array.isArray(post.tags)
      ? post.tags.filter((t): t is string => typeof t === "string")
      : [],
    width: pages[0]?.width || cover.width,
    height: pages[0]?.height || cover.height,
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
  const datetime = fanboxCursorTime(asString(last.publishedDatetime));
  const id = asString(last.id);
  if (!datetime || !id) return null;
  return { datetime, id };
}

export async function fanboxTagged(tag: string, page: number, cookie?: string, safeMode = true): Promise<FetchOk> {
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

export async function fanboxFeedList(
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
