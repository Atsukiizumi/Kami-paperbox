/**
 * 图站 URL 和字段映射（Yande / Konachan / Danbooru）。
 *
 * 作用：拼 list/post JSON 地址，把站点字段收成 WorkCard；挡住未成年相关标签。
 * 用法：booruListUrl / mapBooruCard。请求本身在 upstream.server.ts。
 * 为什么：三个站 JSON 形状接近但 rating、标签字段名不同，集中在这里改。
 */
import { isGifUrl } from "./thumb-url.ts";
import type { BooruSite, WorkCard, WorkDetail, WorkPage, WorkPoolRef } from "./types.ts";

export const BOORU_FEEDS = [
  { id: "recent", label: "最新" },
  { id: "hot", label: "近期热门" },
  { id: "daily", label: "日榜" },
  { id: "weekly", label: "周榜" },
  { id: "monthly", label: "月榜" },
  { id: "popular", label: "高分" },
] as const;

export type BooruFeed = (typeof BOORU_FEEDS)[number]["id"];

export const BOORU_FEED_IDS = BOORU_FEEDS.map((f) => f.id) as [BooruFeed, ...BooruFeed[]];

export function isBooruFeed(v: string): v is BooruFeed {
  return BOORU_FEEDS.some((f) => f.id === v);
}

export function isBooruPeriodFeed(feed: BooruFeed): feed is "daily" | "weekly" | "monthly" {
  return feed === "daily" || feed === "weekly" || feed === "monthly";
}

export function parseBoardDate(raw?: string): { year: number; month: number; day: number; iso: string } {
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), iso: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return {
    year,
    month,
    day,
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/**
 * cdn.donmai.us 的 Cloudflare 口径：带账号 + 已知工具 UA 可免人机验证。
 * gallery-dl 版本号是策略一部分（跟着上游工具版本走，别随手改成浏览器 UA）。
 */
export const DANBOORU_UA = "Mozilla/5.0 gallery-dl/1.27.0";

/**
 * Danbooru 账号的 HTTP Basic 凭据。
 *
 * 作用：Danbooru 开了 Cloudflare 人机验证，匿名请求一律 403；官方口径是带账号的
 *      API 请求可以免验证（forum_topics/26717）。
 * 用法：booruHeaders / fetchMediaResponse 里拼 Authorization。
 * 为什么：放 booru.ts 是为了纯函数可测，服务端只管套上。
 */
export function danbooruAuthHeader(login?: string, apiKey?: string): string | undefined {
  if (!login || !apiKey) return undefined;
  if (typeof Buffer === "undefined") return undefined;
  return `Basic ${Buffer.from(`${login}:${apiKey}`).toString("base64")}`;
}

export const BOORU_ORIGIN: Record<BooruSite, string> = {
  yande: "https://yande.re",
  konachan: "https://konachan.com",
  danbooru: "https://danbooru.donmai.us",
};

const BLOCKED_TAGS = new Set([
  "loli",
  "shota",
  "toddlercon",
  "lolicon",
  "shotacon",
  "child",
  "children",
  "underage",
  "toddler",
  "infant",
  "baby",
  "preteen",
  "kindergarten",
  "grade_schooler",
  "child_on_child",
  "little_girl",
  "little_boy",
  "young_girl",
  "young_boy",
  "flat_chested_loli",
  "loli_girl",
]);

const SKIP_EXT = new Set(["mp4", "webm", "zip", "swf"]);

export function splitTags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function hasBlockedTags(tags: string[]): boolean {
  return tags.some((t) => BLOCKED_TAGS.has(t.toLowerCase()));
}

export function isNsfwRating(rating: string, site: BooruSite): boolean {
  const r = rating.toLowerCase();
  if (site === "danbooru") return r !== "" && r !== "g";
  return r !== "" && r !== "s";
}

export function composeBooruTags(site: BooruSite, user: string, safeMode: boolean): string {
  const parts = splitTags(user)
    .filter((p) => !/^rating:/i.test(p))
    .filter((p) => !BLOCKED_TAGS.has(p.replace(/^[-~]/, "").toLowerCase()))
    .slice(0, 6);
  if (site === "danbooru") {
    // 未登录最多 2 个标签。TD-24：safeMode 下 rating:g 强制占一个位，
    // 用户词输满也不能把它挤掉（挤掉即出成人内容），只保留首词。
    const picked = safeMode ? [...parts.slice(0, 1), "rating:g"] : parts.slice(0, 2);
    return picked.join(" ").trim();
  }
  const extra = safeMode ? ["rating:s", "-loli", "-shota", "-toddlercon"] : ["-loli", "-shota", "-toddlercon"];
  return [...parts, ...extra].join(" ").trim();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
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

export function tagsOf(rec: Record<string, unknown>): string[] {
  if (typeof rec.tag_string === "string") return splitTags(rec.tag_string);
  if (typeof rec.tags === "string") return splitTags(rec.tags);
  if (Array.isArray(rec.tags)) return rec.tags.map((t) => asString(t)).filter(Boolean);
  return [];
}

function absUrl(site: BooruSite, raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("//")) return `https:${v}`;
  if (v.startsWith("/")) return `${BOORU_ORIGIN[site]}${v}`;
  return v;
}

function titleFrom(site: BooruSite, rec: Record<string, unknown>, tags: string[], id: string): string {
  if (site === "danbooru") {
    const character = splitTags(asString(rec.tag_string_character)).slice(0, 2);
    const copy = splitTags(asString(rec.tag_string_copyright)).slice(0, 1);
    const nice = [...character, ...copy].map((t) => t.replace(/_/g, " "));
    if (nice.length) return nice.join(" · ");
  }
  const picked = tags
    .filter((t) => !t.includes(":") && !BLOCKED_TAGS.has(t.toLowerCase()))
    .slice(0, 3)
    .map((t) => t.replace(/_/g, " "));
  return picked.join(" · ") || `#${id}`;
}

function authorOf(site: BooruSite, rec: Record<string, unknown>): { name: string; id: string } {
  if (site === "danbooru") {
    const artist = splitTags(asString(rec.tag_string_artist))[0] || asString(rec.uploader_name) || "danbooru";
    return { name: artist.replace(/_/g, " "), id: artist };
  }
  const name = asString(rec.author) || "unknown";
  return { name, id: name };
}

function extOf(rec: Record<string, unknown>, fileUrl: string): string {
  const ext = asString(rec.file_ext).toLowerCase();
  if (ext) return ext;
  const m = fileUrl.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return m?.[1] ?? "jpg";
}

function booruImageUrls(site: BooruSite, rec: Record<string, unknown>) {
  const preview = absUrl(site, asString(rec.preview_url || rec.preview_file_url));
  const sample = absUrl(site, asString(rec.sample_url || rec.large_file_url || rec.jpeg_url));
  const original = absUrl(site, asString(rec.file_url || rec.jpeg_url || rec.large_file_url));
  const ext = extOf(rec, original || sample || preview);
  const animated = ext === "gif";
  const live = animated ? (isGifUrl(sample) ? sample : original) : "";
  const thumb = (animated ? live : preview) || sample || original;
  const regular = (animated ? live : sample) || original || preview;
  return {
    thumb,
    regular,
    original: original || sample || preview,
    ext,
    animated,
  };
}

function dateOf(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 10_000_000_000 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string" && v) return v;
  return undefined;
}

export function mapBooruCard(
  site: BooruSite,
  raw: unknown,
  safeMode: boolean,
): WorkCard | null {
  const rec = asRecord(raw);
  if (asBool(rec.is_deleted) || asBool(rec.is_banned) || asBool(rec.is_held)) return null;
  const id = asString(rec.id);
  if (!id) return null;
  const tags = tagsOf(rec);
  if (hasBlockedTags(tags)) return null;
  const rating = asString(rec.rating, "s");
  if (safeMode && isNsfwRating(rating, site)) return null;
  const urls = booruImageUrls(site, rec);
  if (!urls.thumb && !urls.original) return null;
  if (SKIP_EXT.has(urls.ext)) return null;
  const author = authorOf(site, rec);
  return {
    source: site,
    id,
    title: titleFrom(site, rec, tags, id),
    author: author.name,
    authorId: author.id,
    thumb: urls.thumb,
    pageCount: 1,
    tags: tags.slice(0, 24),
    width: asNumber(rec.width || rec.image_width) || undefined,
    height: asNumber(rec.height || rec.image_height) || undefined,
    date: dateOf(rec.created_at),
    rating: asString(rec.rating) || undefined,
    illustType: urls.animated ? 2 : undefined,
  };
}

export function mapBooruDetail(
  site: BooruSite,
  raw: unknown,
  safeMode: boolean,
  pools: WorkPoolRef[] = [],
): WorkDetail | null {
  const card = mapBooruCard(site, raw, safeMode);
  if (!card) return null;
  const rec = asRecord(raw);
  const urls = booruImageUrls(site, rec);
  const page: WorkPage = {
    thumb: urls.thumb,
    regular: urls.regular,
    original: urls.original,
    name: `${site}-${card.id}.${urls.ext}`,
    width: card.width,
    height: card.height,
  };
  const source = asString(rec.source);
  return {
    ...card,
    description: source ? `来源 ${source}` : "",
    originSource: source || undefined,
    pages: page.original || page.regular ? [page] : [],
    pools: pools.length ? pools : undefined,
  };
}

export function parseMoebooruPools(html: string): WorkPoolRef[] {
  const out: WorkPoolRef[] = [];
  const seen = new Set<string>();
  const sentence =
    /in the\s*<a href="\/pool\/show\/(\d+)"[^>]*>([^<]*)<\/a>\s*pool/gi;
  for (const match of html.matchAll(sentence)) {
    const id = match[1];
    const name = decodeHtml(match[2] ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name || `合集 ${id}` });
  }
  if (out.length) return out;
  const href = /href="\/pool\/show\/(\d+)"[^>]*>([^<]+)<\/a>/gi;
  for (const match of html.matchAll(href)) {
    const id = match[1];
    const name = decodeHtml(match[2] ?? "").trim();
    if (!id || seen.has(id) || !name) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&/g, "\u0026")
    .replace(/</g, "\u003c")
    .replace(/>/g, "\u003e")
    .replace(/"/g, "\u0022")
    .replace(/&#39;/g, "\u0027");
}

export function booruListUrl(
  site: BooruSite,
  feed: BooruFeed,
  tags: string,
  page: number,
  date?: string,
): string {
  const origin = BOORU_ORIGIN[site];
  const limit = site === "danbooru" ? "40" : "100";
  const when = parseBoardDate(date);
  if (site === "danbooru") {
    if (feed === "daily" || feed === "weekly" || feed === "monthly") {
      const scale = feed === "daily" ? "day" : feed === "weekly" ? "week" : "month";
      const qs = new URLSearchParams({ date: when.iso, scale });
      return `${origin}/explore/posts/popular.json?${qs}`;
    }
    const qs = new URLSearchParams({ limit, page: String(page) });
    const parts = splitTags(tags);
    if (feed === "hot" && !parts.some((p) => p.startsWith("order:"))) {
      if (parts.length < 2) parts.push("order:rank");
    } else if (feed === "popular" && !parts.some((p) => p.startsWith("order:"))) {
      if (parts.length < 2) parts.push("order:score");
    }
    if (parts.length) qs.set("tags", parts.join(" "));
    return `${origin}/posts.json?${qs}`;
  }
  if (feed === "hot") {
    return `${origin}/post/popular_recent.json?period=1d`;
  }
  if (feed === "daily") {
    return `${origin}/post/popular_by_day.json?year=${when.year}&month=${when.month}&day=${when.day}`;
  }
  if (feed === "weekly") {
    return `${origin}/post/popular_by_week.json?year=${when.year}&month=${when.month}&day=${when.day}`;
  }
  if (feed === "monthly") {
    return `${origin}/post/popular_by_month.json?year=${when.year}&month=${when.month}`;
  }
  const qs = new URLSearchParams({ limit, page: String(page) });
  const merged =
    feed === "popular" && !/\border:/.test(tags)
      ? [tags, "order:score"].filter(Boolean).join(" ")
      : tags;
  if (merged) qs.set("tags", merged);
  return `${origin}/post.json?${qs}`;
}

export function booruSuggestUrl(site: BooruSite, prefix: string): string {
  const origin = BOORU_ORIGIN[site];
  const q = prefix.trim();
  if (site === "danbooru") {
    const qs = new URLSearchParams({
      "search[query]": q,
      "search[type]": "tag_query",
      limit: "10",
    });
    return `${origin}/autocomplete.json?${qs}`;
  }
  const qs = new URLSearchParams({
    limit: "10",
    order: "count",
    name: `${q}*`,
  });
  return `${origin}/tag.json?${qs}`;
}

export function pickRelatedTag(tags: string[]): string {
  const skip = /^(rating:|order:|score:|id:|parent:|source:|status:|widescreen|highres|commentary|translated)/i;
  return (
    tags.find(
      (t) =>
        t.length > 2 &&
        !t.startsWith("-") &&
        !skip.test(t) &&
        !BLOCKED_TAGS.has(t.toLowerCase()),
    ) ?? ""
  );
}

export function booruPostUrl(site: BooruSite, id: string): string {
  const origin = BOORU_ORIGIN[site];
  if (site === "danbooru") return `${origin}/posts/${id}.json`;
  return `${origin}/post.json?tags=${encodeURIComponent(`id:${id}`)}`;
}

export function booruPoolUrl(site: BooruSite, id: string): string {
  const origin = BOORU_ORIGIN[site];
  if (site === "danbooru") return `${origin}/pools/${id}.json`;
  return `${origin}/pool/show.json?id=${encodeURIComponent(id)}`;
}

export function poolOriginUrl(site: BooruSite, id: string): string {
  if (site === "danbooru") return `${BOORU_ORIGIN[site]}/pools/${id}`;
  return `${BOORU_ORIGIN[site]}/pool/show/${id}`;
}
