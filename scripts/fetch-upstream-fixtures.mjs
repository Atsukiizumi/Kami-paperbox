// @ts-check
/**
 * 上游解析快照流水线（M1 / docs/06 §6.4#1）。
 *
 * 作用：按站点端点族各抓一次「匿名」真实响应 → sanitizeUpstreamPayload 脱敏 →
 *      落 tests/fixtures/upstream/<site>_<endpoint>.json（含 _meta {fetchedAt,
 *      url, sanitizerVersion}），供 mapping 族测试双模式取样（fixture 在则用
 *      真实样本，缺省回退内联样本，仓库 clone 即 hermetic）。刷新 = 覆盖写入。
 * 用法：node scripts/fetch-upstream-fixtures.mjs（手动跑；CI 只在
 *      .github/workflows/refresh-fixtures.yml 的 workflow_dispatch 里跑）。
 * 为什么：上游改版时 mapping.test.ts 最先红，真实快照给样本更新提供依据。
 *      脱敏是硬闸：响应头全弃、JSON 递归删凭据形键、URL 只留 origin+pathname；
 *      端点全部匿名——任何 Cookie / PHPSESSID / API key 都不允许进流水线。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 与 src/lib/upstream/http.ts 的 UA 一致（匿名请求的体面身份；.mjs 不能直接导 .ts 常量，故复制）。 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PIXIV_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  Referer: "https://www.pixiv.net/",
};
const BOORU_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json,text/plain,*/*",
  Referer: "https://yande.re/",
};

/** 脱敏器版本：fixture 的 _meta 里带上，脱敏口径变更时递增，方便辨认旧快照。 */
export const SANITIZER_VERSION = 2;

/** 凭据形键名（大小写不敏感）。命中即整键删除——键名本身就是敏感面，不再看值。 */
export const CREDENTIAL_KEY_RE = /sessid|token|csrf|secret|authorization|api[_-]?key|cookie/i;

/**
 * URL 只留 origin+pathname：query 里的日期/页码只会让 fixture diff 抖动，
 * 更关键是防止任何形如 ?token=… 的东西借 query 潜入。
 * @param {string} raw
 */
export function publicUrl(raw) {
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

/**
 * 递归删除凭据形键，其余结构原样保留（纯函数：不改入参）。
 * @param {unknown} payload
 * @returns {unknown}
 */
export function sanitizeUpstreamPayload(payload) {
  if (Array.isArray(payload)) return payload.map(sanitizeUpstreamPayload);
  if (payload !== null && typeof payload === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, value] of Object.entries(payload)) {
      if (CREDENTIAL_KEY_RE.test(key)) continue;
      out[key] = sanitizeUpstreamPayload(value);
    }
    return out;
  }
  return payload;
}

/**
 * JST「昨天」：日榜按 JST 翻页，昨天必然已公布（当天在公布窗口内可能 404）。
 * @returns {{ year: number, month: number, day: number }}
 */
function jstYesterday() {
  const d = new Date(Date.now() + 9 * 3_600_000 - 24 * 3_600_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<unknown>}
 */
async function fetchJson(url, headers) {
  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("返回 HTML（反爬/挑战页）");
  return JSON.parse(text);
}

/**
 * 抓一个端点并落 fixture。fetch/校验/写盘任一步失败都只记日志不中断——
 * 单端点失败由测试的内联回退兜底（报告里如实记录即可，不硬抗上游抖动）。
 * @param {string} dir
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string} file
 * @param {(json: unknown) => boolean} validate 内容有效性（error 响应不落盘）
 * @returns {Promise<boolean>}
 */
async function fetchAndWrite(dir, url, headers, file, validate) {
  try {
    const json = await fetchJson(url, headers);
    if (!validate(json)) throw new Error("响应内容校验未过（error/空数据形态）");
    const fixture = {
      _meta: { fetchedAt: new Date().toISOString(), url: publicUrl(url), sanitizerVersion: SANITIZER_VERSION },
      data: sanitizeUpstreamPayload(json),
    };
    writeFileSync(join(dir, file), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`[fixtures] ${file} ✔ ${publicUrl(url)}`);
    return true;
  } catch (err) {
    console.warn(`[fixtures] ${file} ✘ ${publicUrl(url)}：${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Pixiv ajax 搜索词：全年龄大池子标签，匿名可搜的概率最高。 */
const SEARCH_WORD = "オリジナル";

/** @typedef {{ file: string, url: string, validate: (json: unknown) => boolean }} AjaxCandidate */

/**
 * Pixiv /ajax/* 匿名端点：候选按「mapping 样本覆盖面」排序（搜索 > 作品详情 >
 * 相关推荐），匿名 401/403/error 就换下一个——不硬抗、不加凭据。任务口径：
 * 只成样一个 /ajax 端点。
 * @param {string} dir
 * @param {unknown} rankingJson 本次或上次落盘的 ranking 响应（取作品 id 用）
 * @returns {Promise<boolean>}
 */
async function fetchPixivAjaxFixture(dir, rankingJson) {
  /** @type {AjaxCandidate[]} */
  const candidates = [
    {
      file: "pixiv_ajax_search.json",
      url: `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(SEARCH_WORD)}?word=${encodeURIComponent(
        SEARCH_WORD,
      )}&order=date_d&mode=safe&p=1&s_mode=s_tag&type=illust&lang=zh`,
      validate: (json) => {
        const rec = /** @type {{error?: unknown, body?: {illustManga?: {data?: unknown[]}}}} */ (json);
        return rec.error === false && Array.isArray(rec.body?.illustManga?.data) && rec.body.illustManga.data.length > 0;
      },
    },
  ];
  // 作品 id 从 ranking 响应取：fixture 之间互相自洽，也避免硬编码 id 被删后失效。
  const contents = /** @type {{contents?: Array<{illust_id?: unknown}>}} */ (rankingJson)?.contents;
  const illustId = Array.isArray(contents) ? String(contents[0]?.illust_id ?? "") : "";
  if (/^\d+$/.test(illustId)) {
    candidates.push(
      {
        file: "pixiv_ajax_illust.json",
        url: `https://www.pixiv.net/ajax/illust/${illustId}?lang=zh`,
        validate: (json) => {
          const rec = /** @type {{error?: unknown, body?: {id?: unknown}}} */ (json);
          return rec.error === false && Boolean(rec.body?.id);
        },
      },
      {
        file: "pixiv_ajax_recommend.json",
        url: `https://www.pixiv.net/ajax/illust/${illustId}/recommend/init?limit=18&lang=zh`,
        validate: (json) => {
          // 非空校验：mapping 测试对快照断言「产出卡片」，error:false 但空列表的
          // 响应落盘必红，所以这里就拦下。
          const rec = /** @type {{body?: {illusts?: unknown[], thumbnails?: {illust?: unknown[]}}}} */ (json);
          const illusts = rec.body?.illusts;
          const thumbs = rec.body?.thumbnails?.illust;
          return (Array.isArray(illusts) && illusts.length > 0) || (Array.isArray(thumbs) && thumbs.length > 0);
        },
      },
    );
  } else {
    console.warn("[fixtures] pixiv ajax：无可用 ranking 作品 id，详情/推荐候选跳过");
  }
  for (const candidate of candidates) {
    const ok = await fetchAndWrite(dir, candidate.url, PIXIV_HEADERS, candidate.file, candidate.validate);
    if (ok) return true;
  }
  return false;
}

/**
 * 上次落盘的 ranking fixture（本次 ranking 失败时，ajax 候选仍能拿到 id）。
 * @param {string} dir
 */
function readExistingRanking(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "pixiv_ranking.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function main() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "upstream");
  mkdirSync(dir, { recursive: true });

  const d = jstYesterday();
  /** @type {Array<{ file: string, url: string, headers: Record<string, string>, validate: (json: unknown) => boolean }>} */
  const endpoints = [
    {
      file: "yandere_post.json",
      url: "https://yande.re/post.json?limit=20",
      headers: BOORU_HEADERS,
      validate: (json) => Array.isArray(json) && json.length > 0,
    },
    {
      file: "yandere_popular_by_day.json",
      url: `https://yande.re/post/popular_by_day.json?year=${d.year}&month=${d.month}&day=${d.day}`,
      headers: BOORU_HEADERS,
      validate: (json) => Array.isArray(json) && json.length > 0,
    },
    {
      file: "pixiv_ranking.json",
      url: "https://www.pixiv.net/ranking.php?mode=daily&content=illust&p=1&format=json",
      headers: PIXIV_HEADERS,
      validate: (json) => {
        const rec = /** @type {{error?: unknown, contents?: unknown[]}} */ (json);
        return rec.error !== true && Array.isArray(rec.contents) && rec.contents.length > 0;
      },
    },
  ];

  let ok = 0;
  /** @type {unknown} */
  let rankingJson;
  for (const ep of endpoints) {
    const done = await fetchAndWrite(dir, ep.url, ep.headers, ep.file, ep.validate);
    if (done) ok += 1;
    if (ep.file === "pixiv_ranking.json" && done) {
      rankingJson = await fetchJson(ep.url, ep.headers); // 复用本次响应给 ajax 候选取 id
    }
  }
  const ajaxOk = await fetchPixivAjaxFixture(dir, rankingJson ?? readExistingRanking(dir));
  if (ajaxOk) ok += 1;

  const total = endpoints.length + 1;
  console.log(`[fixtures] 完成：${ok}/${total} 个端点成样 → ${dir}`);
  if (ok === 0) {
    console.warn("[fixtures] 全部端点失败：网络/上游不可达，fixtures 保持缺省（测试走内联回退）");
    process.exitCode = 1;
  }
}

// 直接 node 执行才抓取；被单测 import 时只取纯函数，不发网络请求。
const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) void main();
