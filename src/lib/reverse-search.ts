/**
 * 搜图引擎列表和结果解析（客户端形状）。
 *
 * 作用：SauceNAO / ascii2d / IQDB / TinEye 的标识；把源站链接收成作品。
 * 用法：实际上传在 reverse-search.server.ts，避免把图和 API key 暴露给页面。
 */
import type { Source } from "./types";

export type SearchEngine = "saucenao" | "ascii2d" | "iqdb" | "tineye";

export const SEARCH_ENGINES = [
  { id: "saucenao", label: "SauceNAO", origin: "https://saucenao.com/" },
  { id: "ascii2d", label: "ascii2d", origin: "https://ascii2d.net/" },
  { id: "iqdb", label: "IQDB", origin: "https://iqdb.org/" },
  { id: "tineye", label: "TinEye", origin: "https://tineye.com/" },
] as const satisfies ReadonlyArray<{ id: SearchEngine; label: string; origin: string }>;

export const DEFAULT_SEARCH_ENGINE: SearchEngine = "saucenao";
export const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
export const SEARCH_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);

const BLOCKED = new Set(["loli", "shota", "toddlercon", "lolicon", "shotacon"]);

export type ReverseHit = {
  engine: SearchEngine;
  similarity: number;
  title: string;
  author: string;
  thumb: string;
  sourceUrl: string;
  site?: Source;
  workId?: string;
  extra: string;
};

export function isSearchEngine(v: string): v is SearchEngine {
  return SEARCH_ENGINES.some((e) => e.id === v);
}

export function parseSearchEngine(v: string | null | undefined): SearchEngine {
  return v && isSearchEngine(v) ? v : DEFAULT_SEARCH_ENGINE;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function absUrl(base: string, raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("//")) return `https:${v}`;
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.startsWith("/")) {
    try {
      return new URL(v, base).toString();
    } catch {
      return "";
    }
  }
  return v;
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m?.[1] ? decodeHtml(m[1]) : "";
}

function splitWords(raw: string): string[] {
  return raw
    .split(/[\s,_]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function blocked(tags: string[]): boolean {
  return tags.some((t) => BLOCKED.has(t.toLowerCase()));
}

export function workFromUrl(url: string): { site: Source; id: string } | null {
  if (!url) return null;
  const pixiv = url.match(/pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i) || url.match(/[?&]illust_id=(\d+)/i);
  if (pixiv?.[1]) return { site: "pixiv", id: pixiv[1] };
  const yande = url.match(/yande\.re\/post\/show\/(\d+)/i);
  if (yande?.[1]) return { site: "yande", id: yande[1] };
  const kona = url.match(/konachan\.(?:com|net)\/post\/show\/(\d+)/i);
  if (kona?.[1]) return { site: "konachan", id: kona[1] };
  const danbooru = url.match(/donmai\.us\/posts\/(\d+)/i);
  if (danbooru?.[1]) return { site: "danbooru", id: danbooru[1] };
  const fanbox = url.match(/fanbox\.cc\/(?:posts\/|@[^/]+\/posts\/)(\d+)/i);
  if (fanbox?.[1]) return { site: "fanbox", id: fanbox[1] };
  return null;
}

function withWork(hit: ReverseHit): ReverseHit {
  const mapped = workFromUrl(hit.sourceUrl);
  if (!mapped) return hit;
  return { ...hit, site: mapped.site, workId: mapped.id };
}

export function parseSauceNaoHtml(html: string, _safeMode: boolean): ReverseHit[] {
  const hits: ReverseHit[] = [];
  const re = /<div class="result(\s+hidden)?"[\s\S]*?<table class="resulttable">([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const hidden = Boolean(m[1]);
    const block = m[2] ?? "";
    const sim = Number(block.match(/resultsimilarityinfo">([\d.]+)%/)?.[1] ?? 0);
    if (hidden && !(Number.isFinite(sim) && sim >= 50)) continue;
    const title = decodeHtml(
      block.match(/resulttitle">[\s\S]*?<strong>([^<]+)/)?.[1]?.trim() ||
        block.match(/resulttitle">([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, " ").trim() ||
        "",
    );
    const author = decodeHtml(
      block.match(/Member:\s*<\/strong>\s*<a[^>]*>([^<]+)/i)?.[1]?.trim() ||
        block.match(/Creator:\s*<\/strong>\s*(?:<a[^>]*>)?([^<]+)/i)?.[1]?.trim() ||
        "",
    );
    const thumbRaw = block.match(/resultimage[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1] ?? "";
    const hrefs = [...block.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((x) => x[1] ?? "");
    const pixivId =
      block.match(/pixiv(?:\s*ID)?[:\s#]+(\d{4,})/i)?.[1] ||
      hrefs.map((h) => h.match(/artworks\/(\d+)/i)?.[1] || h.match(/illust_id=(\d+)/i)?.[1]).find(Boolean);
    let sourceUrl = hrefs.find((h) => h && !/saucenao\.com/i.test(h)) || hrefs[0] || "";
    if (pixivId && !/pixiv\.net/i.test(sourceUrl)) {
      sourceUrl = `https://www.pixiv.net/artworks/${pixivId}`;
    }
    const extra = decodeHtml((block.match(/title="Index[^"]*:\s*([^"]+)"/)?.[1] || "").trim());
    if (blocked(splitWords(`${title} ${author} ${extra}`))) continue;
    hits.push(
      withWork({
        engine: "saucenao",
        similarity: Number.isFinite(sim) ? sim : 0,
        title: title || extra || "未命名",
        author,
        thumb: absUrl("https://saucenao.com/", thumbRaw),
        sourceUrl,
        extra,
      }),
    );
  }
  return hits.sort((a, b) => b.similarity - a.similarity);
}

export function parseSauceNaoJson(raw: unknown, _safeMode: boolean): ReverseHit[] {
  const root = asRecord(raw);
  const rows = Array.isArray(root.results) ? root.results : [];
  const hits: ReverseHit[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const header = asRecord(rec.header);
    const data = asRecord(rec.data);
    const sim = asNumber(header.similarity);
    const urls = Array.isArray(data.ext_urls) ? data.ext_urls.map(asString).filter(Boolean) : [];
    const pixivId = asString(data.pixiv_id) || asString(data.pixivid);
    if (pixivId && !urls.some((u) => /pixiv\.net/i.test(u))) {
      urls.unshift(`https://www.pixiv.net/artworks/${pixivId}`);
    }
    const sourceUrl = urls.find((h) => h && !/saucenao\.com/i.test(h)) || urls[0] || "";
    const creator = data.creator;
    const author = Array.isArray(creator)
      ? creator.map(asString).filter(Boolean).join(", ")
      : asString(data.member_name) || asString(creator) || asString(data.author_name);
    const title = asString(data.title) || asString(data.material) || asString(header.index_name);
    const extra = asString(header.index_name);
    if (blocked(splitWords(`${title} ${author} ${extra}`))) continue;
    if (!sourceUrl && sim <= 0) continue;
    hits.push(
      withWork({
        engine: "saucenao",
        similarity: sim,
        title: title || extra || "未命名",
        author,
        thumb: asString(header.thumbnail),
        sourceUrl,
        extra,
      }),
    );
  }
  return hits.sort((a, b) => b.similarity - a.similarity);
}

export function parseIqdbHtml(html: string, safeMode: boolean): ReverseHit[] {
  const chunk = html.split(/id=["']pages["']/)[1] ?? html;
  const tables = chunk.split(/<table>/i).slice(1);
  const hits: ReverseHit[] = [];
  for (const table of tables) {
    const header = decodeHtml(table.match(/<th>([^<]*)<\/th>/i)?.[1] ?? "");
    if (/your image/i.test(header)) continue;
    const href = table.match(/<a\s+href=["']([^"']+)["']/i)?.[1] ?? "";
    if (!href) continue;
    const imgTag = table.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const thumbRaw = attr(imgTag, "src");
    const alt = attr(imgTag, "title") || attr(imgTag, "alt");
    const sim = Number(table.match(/([\d.]+)\s*%\s*similarity/i)?.[1] ?? 0);
    const rating =
      table.match(/\[(Safe|Questionable|Explicit)\]/i)?.[1] ||
      alt.match(/Rating:\s*([sqe])/i)?.[1] ||
      "";
    const tags = splitWords(alt.replace(/Rating:[^T]*Tags:/i, " "));
    if (blocked(tags)) continue;
    if (safeMode && /^(e|explicit|q|questionable)$/i.test(rating)) continue;
    const siteLabel = decodeHtml(
      table.match(/class="service-icon"[^>]*>\s*([^<]+)/i)?.[1] ||
        table.match(/>(yande\.re|danbooru|gelbooru|konachan|sankaku|anime-pictures)[^<]*/i)?.[1] ||
        header,
    );
    hits.push(
      withWork({
        engine: "iqdb",
        similarity: Number.isFinite(sim) ? sim : 0,
        title: tags.slice(0, 4).join(" · ").replace(/_/g, " ") || siteLabel || "匹配",
        author: siteLabel.trim(),
        thumb: absUrl("https://iqdb.org/", thumbRaw),
        sourceUrl: absUrl("https://iqdb.org/", href),
        extra: header,
      }),
    );
  }
  return hits;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

export function parseTinEyeJson(raw: unknown): ReverseHit[] {
  const root = asRecord(raw);
  const matches = Array.isArray(root.matches) ? root.matches : [];
  const hits: ReverseHit[] = [];
  for (const item of matches) {
    const rec = asRecord(item);
    const links = Array.isArray(rec.backlinks) ? rec.backlinks.map(asRecord) : [];
    const first = links[0] ?? {};
    const sourceUrl = asString(first.backlink) || asString(first.url);
    const name = asString(first.image_name) || asString(rec.domain);
    if (blocked(splitWords(name))) continue;
    hits.push(
      withWork({
        engine: "tineye",
        similarity: asNumber(rec.score),
        title: name.replace(/_/g, " ") || asString(rec.domain) || "网页匹配",
        author: asString(rec.domain),
        thumb: asString(rec.image_url),
        sourceUrl,
        extra: asString(rec.domain),
      }),
    );
  }
  return hits;
}

export function parseAscii2dHtml(html: string, extra = "特征"): ReverseHit[] {
  const blocks = html.split(/class="[^"]*item-box[^"]*"/i).slice(1);
  const hits: ReverseHit[] = [];
  for (const raw of blocks) {
    const block = raw.slice(0, 12_000);
    const img = block.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? "";
    const hrefs = [...block.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((x) => x[1] ?? "");
    const sourceUrl = hrefs.find((h) => h && !/ascii2d\.net/i.test(h)) || "";
    if (!sourceUrl) continue;
    const links = [...block.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([^<]*)<\/a>/gi)];
    const named = links.filter((l) => l[1] && !/ascii2d\.net/i.test(l[1] ?? ""));
    const title = decodeHtml(named[0]?.[2]?.trim() || "");
    const author = decodeHtml(named[1]?.[2]?.trim() || "");
    if (blocked(splitWords(`${title} ${author}`))) continue;
    hits.push(
      withWork({
        engine: "ascii2d",
        similarity: 0,
        title: title || extra || "ascii2d 匹配",
        author,
        thumb: absUrl("https://ascii2d.net/", img),
        sourceUrl,
        extra,
      }),
    );
  }
  return hits;
}

export function ascii2dBovwUrl(html: string, fromUrl = ""): string {
  const fromPage = html.match(/\/search\/bovw\/([a-f0-9]+)/i)?.[1];
  const fromLoc = fromUrl.match(/\/search\/(?:color|bovw)\/([a-f0-9]+)/i)?.[1];
  const hash = fromPage || fromLoc;
  return hash ? `https://ascii2d.net/search/bovw/${hash}` : "";
}

type Stashed = { name: string; type: string; bytes: ArrayBuffer };
let stashed: Stashed | null = null;

export function stashReverseImage(image: Stashed) {
  stashed = image;
}

export function takeReverseImage(): Stashed | null {
  const next = stashed;
  stashed = null;
  return next;
}
