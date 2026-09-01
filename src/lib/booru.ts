/**
 * 图站 URL 和字段映射（Yande / Konachan / Danbooru）。
 *
 * 作用：拼 list/post JSON 地址，把站点字段收成 WorkCard；挡住未成年相关标签。
 * 用法：booruListUrl / mapBooruCard。请求本身在 upstream.server.ts。
 * 为什么：三个站 JSON 形状接近但 rating、标签字段名不同，集中在这里改。
 */
import type { BooruSite, WorkCard, WorkDetail, WorkPage } from "./types";

export const DANBOORU_UA = "Mozilla/5.0 gallery-dl/1.27.0";

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
    const first = parts.find((p) => !p.startsWith("order:")) ?? "";
    if (safeMode) return [first, "rating:g"].filter(Boolean).join(" ");
    return first;
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
  const preview = absUrl(
    site,
    asString(rec.preview_url || rec.preview_file_url || rec.sample_url || rec.large_file_url),
  );
  const file = absUrl(site, asString(rec.file_url || rec.jpeg_url || rec.large_file_url));
  if (!preview && !file) return null;
  const ext = extOf(rec, file || preview);
  if (SKIP_EXT.has(ext)) return null;
  const author = authorOf(site, rec);
  return {
    source: site,
    id,
    title: titleFrom(site, rec, tags, id),
    author: author.name,
    authorId: author.id,
    thumb: preview || file,
    pageCount: 1,
    tags: tags.slice(0, 24),
    width: asNumber(rec.width || rec.image_width) || undefined,
    height: asNumber(rec.height || rec.image_height) || undefined,
    date: dateOf(rec.created_at),
    rating: asString(rec.rating) || undefined,
  };
}

export function mapBooruDetail(
  site: BooruSite,
  raw: unknown,
  safeMode: boolean,
): WorkDetail | null {
  const card = mapBooruCard(site, raw, safeMode);
  if (!card) return null;
  const rec = asRecord(raw);
  const preview = absUrl(site, asString(rec.preview_url || rec.preview_file_url));
  const sample = absUrl(site, asString(rec.sample_url || rec.large_file_url || rec.jpeg_url));
  const original = absUrl(site, asString(rec.file_url || rec.jpeg_url || rec.large_file_url));
  const ext = extOf(rec, original || sample);
  const page: WorkPage = {
    thumb: preview || sample || original,
    regular: sample || original,
    original: original || sample,
    name: `${site}-${card.id}.${ext}`,
    width: card.width,
    height: card.height,
  };
  const source = asString(rec.source);
  return {
    ...card,
    description: source ? `来源 ${source}` : "",
    pages: page.original || page.regular ? [page] : [],
  };
}

export function booruListUrl(
  site: BooruSite,
  feed: "recent" | "popular",
  tags: string,
  page: number,
): string {
  const origin = BOORU_ORIGIN[site];
  const limit = site === "danbooru" ? "40" : "100";
  if (site === "danbooru") {
    const qs = new URLSearchParams({ limit, page: String(page) });
    const parts = splitTags(tags);
    if (feed === "popular" && !parts.some((p) => p.startsWith("order:"))) {
      if (parts.length < 2) parts.push("order:score");
    }
    if (parts.length) qs.set("tags", parts.join(" "));
    return `${origin}/posts.json?${qs}`;
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
