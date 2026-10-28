/**
 * 搜图引擎列表和结果解析（客户端形状）。
 *
 * 作用：SauceNAO / ascii2d / IQDB / trace.moe / Danbooru 的标识；把源站链接收成作品。
 * 用法：实际上传在 reverse-search.server.ts，避免把图和 API key 暴露给页面。
 */
import type { Source } from "./types.ts";
import { decodeHtmlEntities } from "./utils.ts";
import { asNumber, asRecord, asStringLoose as asString } from "./parse.ts";

export type SearchEngine = "saucenao" | "ascii2d" | "iqdb" | "tracemoe" | "danbooru";

export const SEARCH_ENGINES = [
  { id: "saucenao", label: "SauceNAO", origin: "https://saucenao.com/" },
  { id: "ascii2d", label: "ascii2d", origin: "https://ascii2d.net/" },
  { id: "iqdb", label: "IQDB", origin: "https://iqdb.org/" },
  { id: "tracemoe", label: "trace.moe", origin: "https://trace.moe/" },
  { id: "danbooru", label: "Danbooru", origin: "https://danbooru.donmai.us/" },
] as const satisfies ReadonlyArray<{ id: SearchEngine; label: string; origin: string }>;

export const DEFAULT_SEARCH_ENGINE: SearchEngine = "saucenao";
export const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
export const SEARCH_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);

export function engineLabel(id: SearchEngine): string {
  return SEARCH_ENGINES.find((e) => e.id === id)?.label ?? id;
}

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

export type SearchGroup = {
  engine: SearchEngine;
  status: "ok" | "empty" | "limited" | "error";
  items: ReverseHit[];
  error?: string;
};

export function isSearchEngine(v: string): v is SearchEngine {
  return SEARCH_ENGINES.some((e) => e.id === v);
}

export function parseSearchEngine(v: string | null | undefined): SearchEngine {
  return v && isSearchEngine(v) ? v : DEFAULT_SEARCH_ENGINE;
}

function decodeHtml(s: string): string {
  return decodeHtmlEntities(s);
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
    const urls = Array.isArray(data.ext_urls) ? data.ext_urls.map((v) => asString(v)).filter(Boolean) : [];
    const pixivId = asString(data.pixiv_id) || asString(data.pixivid);
    if (pixivId && !urls.some((u) => /pixiv\.net/i.test(u))) {
      urls.unshift(`https://www.pixiv.net/artworks/${pixivId}`);
    }
    const sourceUrl = urls.find((h) => h && !/saucenao\.com/i.test(h)) || urls[0] || "";
    const creator = data.creator;
    const author = Array.isArray(creator)
      ? creator.map((v) => asString(v)).filter(Boolean).join(", ")
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

/**
 * SauceNAO 官方 JSON 回包 header 的判读。
 *
 * 作用：把 429 / -2 之类官方语义翻成准确的话。
 * 为什么：撞官方 API 限额时 SauceNAO 回 429 + JSON（header.status=-2），
 *        那是它自家的 30 秒窗口限流，不是 Cloudflare 风控；照风控报会吓到
 *        已经填了 key 的用户。返回 undefined 表示 header 没说人话，交给外层。
 */
export function sauceNaoApiError(
  header: { status?: number; message?: string } | undefined,
  httpStatus: number,
): string | undefined {
  if (!header) return undefined;
  const hStatus = typeof header.status === "number" ? header.status : 0;
  const message = header.message?.trim() ?? "";
  if (httpStatus === 429 || hStatus === -2 || /rate limit/i.test(message)) {
    return "SauceNAO 官方接口限流：30 秒窗口次数用完，等半分钟再搜（不是风控，key 仍有效）";
  }
  if (hStatus === -3 || hStatus === -4 || /daily/i.test(message)) {
    return "SauceNAO 今日次数用完了，明天再试，或换 IQDB";
  }
  if (hStatus < 0 && message && !/anonymous account type does not permit API/i.test(message)) {
    return message.slice(0, 160);
  }
  return undefined;
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

function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** trace.moe 公开接口。similarity 是 0–1；anilist 可能是数字，也可能是带标题的对象。 */
export function parseTraceMoeJson(raw: unknown, safeMode: boolean): ReverseHit[] {
  const root = asRecord(raw);
  const rows = Array.isArray(root.result) ? root.result : [];
  const hits: ReverseHit[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const info = asRecord(rec.anilist);
    const anilistId = asNumber(info.id, asNumber(rec.anilist));
    const titles = asRecord(info.title);
    const native = asString(titles.native);
    const romaji = asString(titles.romaji);
    const english = asString(titles.english);
    if (safeMode && info.isAdult === true) continue;
    const simRaw = asNumber(rec.similarity);
    const similarity = simRaw > 0 && simRaw <= 1 ? Math.round(simRaw * 1000) / 10 : simRaw;
    const episode = asNumber(rec.episode);
    const scene = [episode > 0 ? `第 ${episode} 话` : "", clockLabel(asNumber(rec.from))].filter(Boolean).join(" · ");
    const title = native || romaji || english || "动画截图";
    const author = [romaji && romaji !== title ? romaji : english && english !== title ? english : "", scene]
      .filter(Boolean)
      .join(" · ");
    const thumb = asString(rec.image);
    const sourceUrl = anilistId > 0 ? `https://anilist.co/anime/${anilistId}` : thumb;
    if (!sourceUrl && similarity <= 0) continue;
    hits.push({
      engine: "tracemoe",
      similarity,
      title,
      author,
      thumb,
      sourceUrl,
      extra: scene || "动画",
    });
  }
  return hits.sort((a, b) => b.similarity - a.similarity).slice(0, 8);
}

/** Danbooru 自己的相似图。有嵌套 post 时带预览和分级；只有 post_id 也能打开原帖。 */
export function parseDanbooruIqdbJson(raw: unknown, safeMode: boolean): ReverseHit[] {
  const root = asRecord(raw);
  const rows = Array.isArray(root.matches) ? root.matches : Array.isArray(raw) ? raw : [];
  const hits: ReverseHit[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const post = asRecord(rec.post);
    const id = asString(post.id) || asString(rec.post_id) || asString(rec.postId);
    if (!id || !/^\d+$/.test(id)) continue;
    const tags = splitWords(asString(post.tag_string) || asString(post.tag_string_general));
    if (blocked(tags)) continue;
    const rating = asString(post.rating).toLowerCase();
    if (safeMode && /^(e|q|explicit|questionable)$/i.test(rating)) continue;
    let sim = asNumber(rec.score, asNumber(rec.similarity));
    if (sim > 0 && sim <= 1) sim = Math.round(sim * 1000) / 10;
    const source = asString(post.source);
    const postUrl = `https://danbooru.donmai.us/posts/${id}`;
    const sourceUrl = /^https?:\/\//i.test(source) ? source : postUrl;
    const thumb = absUrl(
      "https://danbooru.donmai.us/",
      asString(post.preview_file_url) || asString(rec.preview_url),
    );
    hits.push(
      withWork({
        engine: "danbooru",
        similarity: sim,
        title: tags.slice(0, 4).join(" · ").replace(/_/g, " ") || `Danbooru #${id}`,
        author: "Danbooru",
        thumb,
        sourceUrl,
        extra: "Danbooru",
      }),
    );
  }
  return hits.sort((a, b) => b.similarity - a.similarity).slice(0, 12);
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
