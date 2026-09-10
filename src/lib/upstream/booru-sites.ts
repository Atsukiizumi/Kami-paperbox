/**
 * Booru 站点适配（yande / konachan / danbooru）：列表 / 详情 / 合集 / 标签建议
 * （由 upstream.server.ts 拆出，TD-01）。konachan 镜像兜底与 Danbooru 的
 * Cloudflare curl 通道都在这里。
 */
import {
  BOORU_ORIGIN,
  DANBOORU_UA,
  booruListUrl,
  booruPoolUrl,
  booruPostUrl,
  booruSuggestUrl,
  composeBooruTags,
  danbooruAuthHeader,
  parseMoebooruPools,
  mapBooruCard,
  mapBooruDetail,
  type BooruFeed,
} from "../booru.ts";
import { parseBooruSuggest, parsePixivSuggest } from "../tag-suggest.ts";
import { outboundFetch } from "../curl-fetch.server.ts";
import type { BooruSite, FetchOk, Source, WorkCard } from "../types.ts";
import { asNumber, asRecord, asString, upstreamJson } from "./http.ts";
import { UA } from "./http.ts";

export type BooruAuth = { danbooruLogin?: string; danbooruApiKey?: string };

const KONACHAN_ORIGIN = "https://konachan.com";
/** konachan 的全年龄镜像。konachan.com 被 Cloudflare 拦时拿它兜底。 */
const KONACHAN_MIRROR = "https://konachan.net";

function booruHeaders(
  site: BooruSite,
  origin: string,
  auth?: BooruAuth,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": site === "danbooru" ? DANBOORU_UA : UA,
    Accept: "application/json,text/plain,*/*",
    Referer: `${origin}/`,
  };
  if (site === "danbooru" && auth?.danbooruLogin && auth.danbooruApiKey) {
    // Danbooru 官方口径：带账号的 API 请求可免 Cloudflare 人机验证。
    const authorization = danbooruAuthHeader(auth.danbooruLogin, auth.danbooruApiKey);
    if (authorization) headers.Authorization = authorization;
  }
  return headers;
}

export async function booruJson(site: BooruSite, url: string, auth?: BooruAuth): Promise<unknown> {
  const origin = BOORU_ORIGIN[site];
  const headers = booruHeaders(site, origin, auth);
  if (site === "danbooru") {
    const { curlFetch } = await import("../curl-fetch.server");
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
  let res = await outboundFetch(url, { headers, redirect: "follow" });
  let text = res.ok ? await res.text() : "";
  const looksLikeHtml = (t: string) => t.trimStart().startsWith("<");
  // konachan.com 被 Cloudflare 人机验证整域拦杀（2026-09 起）——拦杀期返回的
  // 常是 200 + 挑战页 HTML（TD-11），所以 !ok 或 HTML 都要兜底。konachan.net
  // 是同一套 Moebooru 的全年龄镜像，没被墙；墙撤了 .com 会自动恢复优先。
  if (site === "konachan" && url.startsWith(KONACHAN_ORIGIN) && (!res.ok || looksLikeHtml(text))) {
    res = await outboundFetch(url.replace(KONACHAN_ORIGIN, `${KONACHAN_MIRROR}`), {
      headers: booruHeaders(site, KONACHAN_MIRROR, auth),
      redirect: "follow",
    });
    if (res.ok) text = await res.text();
  }
  if (!res.ok) {
    throw new Error(
      site === "yande" ? `Yande 请求失败（${res.status}）` : `${site} 请求失败（${res.status}）`,
    );
  }
  if (looksLikeHtml(text)) {
    throw new Error("源站暂时拒绝访问，请稍后再试");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("源站返回了无法解析的数据");
  }
}

export function asBooruPosts(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.map(asRecord);
  const rec = asRecord(json);
  if (rec.success === false || rec.error) {
    throw new Error(asString(rec.message || rec.error, "检索失败"));
  }
  if (Array.isArray(rec.posts)) return rec.posts.map(asRecord);
  if (asString(rec.id)) return [rec];
  return [];
}

export async function booruList(
  site: BooruSite,
  feed: BooruFeed,
  tags: string,
  page: number,
  safeMode: boolean,
  date?: string,
  auth?: BooruAuth,
): Promise<FetchOk> {
  const composed = composeBooruTags(site, tags, safeMode);
  const json = await booruJson(site, booruListUrl(site, feed, composed, page, date), auth);
  const records = asBooruPosts(json);
  const items: WorkCard[] = [];
  for (const rec of records) {
    const card = mapBooruCard(site, rec, safeMode);
    if (card) items.push(card);
  }
  const canPage = feed === "recent" || (feed === "popular" && site === "danbooru") || (feed === "hot" && site === "danbooru");
  return {
    op: "booruList",
    site,
    items,
    // TD-12：以「过滤前」的原始条数判断还有下一页——safeMode 过滤掉大半时，
    // items.length 不足阈值不代表源站没了下一页
    nextPage: canPage && records.length >= 8 ? page + 1 : null,
  };
}

export async function booruHtml(site: BooruSite, url: string): Promise<string> {
  const origin = BOORU_ORIGIN[site];
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    Referer: `${origin}/`,
  };
  const res = await outboundFetch(url, { headers, redirect: "follow" });
  if (!res.ok) return "";
  return res.text();
}

async function danbooruPoolsForPost(id: string, auth?: BooruAuth): Promise<{ id: string; name: string }[]> {
  try {
    const json = await booruJson(
      "danbooru",
      `${BOORU_ORIGIN.danbooru}/pools.json?search[post_id]=${encodeURIComponent(id)}&limit=8`,
      auth,
    );
    if (!Array.isArray(json)) return [];
    const out: { id: string; name: string }[] = [];
    for (const raw of json) {
      const rec = asRecord(raw);
      const poolId = asString(rec.id);
      const name = asString(rec.name).replace(/_/g, " ");
      if (poolId) out.push({ id: poolId, name: name || `合集 ${poolId}` });
    }
    return out;
  } catch {
    return [];
  }
}

export async function booruPost(site: BooruSite, id: string, safeMode: boolean, auth?: BooruAuth): Promise<FetchOk> {
  const json = await booruJson(site, booruPostUrl(site, id), auth);
  const rec = asBooruPosts(json)[0];
  if (!rec) throw new Error("作品不存在");
  let pools = parseMoebooruPools("");
  if (site !== "danbooru") {
    try {
      pools = parseMoebooruPools(await booruHtml(site, `${BOORU_ORIGIN[site]}/post/show/${id}`));
    } catch {
      pools = [];
    }
  } else {
    pools = await danbooruPoolsForPost(id, auth);
  }
  const work = mapBooruDetail(site, rec, safeMode, pools);
  if (!work) {
    if (mapBooruDetail(site, rec, false)) {
      throw new Error("已关闭 R-18，该作品被隐藏。可在浏览页打开 R-18。");
    }
    throw new Error("作品不存在，或包含被过滤的内容");
  }
  return { op: "booruPost", work };
}

export async function booruPool(site: BooruSite, id: string, safeMode: boolean, auth?: BooruAuth): Promise<FetchOk> {
  const meta = asRecord(await booruJson(site, booruPoolUrl(site, id), auth));
  if (asString(meta.id) && asString(meta.id) !== id && site !== "danbooru") {
    /* show.json 仍可能只有 posts */
  }
  const name = asString(meta.name) || `合集 ${id}`;
  const description = asString(meta.description);
  const postCount = asNumber(meta.post_count || (Array.isArray(meta.post_ids) ? meta.post_ids.length : 0));
  const items: WorkCard[] = [];
  const seen = new Set<string>();
  for (const rec of asBooruPosts(meta)) {
    const card = mapBooruCard(site, rec, safeMode);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    items.push(card);
  }
  for (let page = 1; page <= 6; page += 1) {
    if (postCount > 0 && items.length >= postCount) break;
    const list = await booruList(site, "recent", `pool:${id}`, page, safeMode);
    if (list.op !== "booruList") break;
    let added = 0;
    for (const card of list.items) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      items.push(card);
      added += 1;
    }
    if (!list.nextPage || added === 0) break;
  }
  if (items.length === 0 && !name) throw new Error("合集不存在");
  return {
    op: "booruPool",
    site,
    id,
    name,
    description,
    postCount: postCount || items.length,
    items,
  };
}

export async function tagSuggest(source: Source, word: string, pixiv?: string, auth?: BooruAuth): Promise<FetchOk> {
  const prefix = word.trim();
  if (!prefix) return { op: "tagSuggest", items: [] };
  if (source === "fanbox") return { op: "tagSuggest", items: [] };
  if (source === "pixiv") {
    const encoded = encodeURIComponent(prefix);
    try {
      const ajax = parsePixivSuggest(
        await upstreamJson(`https://www.pixiv.net/ajax/search/suggest?word=${encoded}&lang=zh`, {
          cookie: pixiv,
          origin: "pixiv",
        }),
      );
      if (ajax.length) return { op: "tagSuggest", items: ajax };
    } catch {
      /* cps.php 还在 */
    }
    try {
      const cps = parsePixivSuggest(
        await upstreamJson(`https://www.pixiv.net/rpc/cps.php?keyword=${encoded}&lang=zh`, {
          cookie: pixiv,
          origin: "pixiv",
        }),
      );
      return { op: "tagSuggest", items: cps };
    } catch {
      return { op: "tagSuggest", items: [] };
    }
  }
  try {
    const json = await booruJson(source, booruSuggestUrl(source, prefix), auth);
    return { op: "tagSuggest", items: parseBooruSuggest(source, json) };
  } catch {
    return { op: "tagSuggest", items: [] };
  }
}
