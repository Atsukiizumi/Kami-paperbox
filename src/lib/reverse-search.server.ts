import {
  MAX_SEARCH_BYTES,
  SEARCH_TYPES,
  SEARCH_ENGINES,
  type ReverseHit,
  type SearchEngine,
  type SearchGroup,
  ascii2dBovwUrl,
  engineLabel,
  parseAscii2dHtml,
  parseDanbooruIqdbJson,
  parseIqdbHtml,
  parseSauceNaoHtml,
  parseSauceNaoJson,
  sauceNaoApiError,
  parseTraceMoeJson,
} from "./reverse-search.ts";
import { DANBOORU_UA, danbooruAuthHeader } from "./booru.ts";
import {
  challengeMessage,
  isBotChallenge,
  isSearchLimited,
  searchGapMs,
} from "./reverse-search-guard.ts";
import { outboundFetch } from "./curl-fetch.server.ts";
import { sleep } from "./utils.ts";
import { getThrottle } from "./throttle.server.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const lastSearchAt = new Map<SearchEngine, number>();
/** ascii2d 弹出验证码后停 10 分钟，不再连续撞。 */
let ascii2dCoolUntil = 0;
/** SauceNAO 的 Cloudflare 浏览器验证同理：服务器直连过不了 JS 挑战
 *  （2026-10 实测 GET / POST / curl 全 403 "Just a moment"），被拦后停 10 分钟。 */
let sauceNaoCoolUntil = 0;

type SessionJar = { cookie: string; token: string; at: number };
const jars = new Map<string, SessionJar>();
const JAR_TTL_MS = 8 * 60 * 1000;

function engineName(engine: SearchEngine): string {
  return engineLabel(engine);
}

function coolAscii2d() {
  ascii2dCoolUntil = Date.now() + 10 * 60_000;
}

function assertAscii2dCool() {
  const wait = ascii2dCoolUntil - Date.now();
  if (wait <= 0) return;
  const minutes = Math.max(1, Math.ceil(wait / 60_000));
  throw new Error(`ascii2d 刚刚被验证码拦住，先停 ${minutes} 分钟。纸匣不代解验证码，继续撞会更严。`);
}

function assertSauceNaoCool() {
  const wait = sauceNaoCoolUntil - Date.now();
  if (wait <= 0) return;
  const minutes = Math.max(1, Math.ceil(wait / 60_000));
  throw new Error(
    `SauceNAO 的浏览器验证还开着，约 ${minutes} 分钟内自动跳过它。IQDB / trace.moe / ascii2d 不受影响，先用它们搜。`,
  );
}

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function mergeCookie(prev: string, setCookies: string[]): string {
  const map = new Map<string, string>();
  for (const part of prev.split(";")) {
    const trimmed = part.trim();
    const i = trimmed.indexOf("=");
    if (i > 0) map.set(trimmed.slice(0, i), trimmed.slice(i + 1));
  }
  for (const raw of setCookies) {
    const first = raw.split(";")[0]?.trim() ?? "";
    const i = first.indexOf("=");
    if (i > 0) map.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function pace(engine: SearchEngine, hasApiKey: boolean) {
  const gap = searchGapMs(engine, hasApiKey, getThrottle().search);
  const last = lastSearchAt.get(engine) ?? 0;
  const wait = last + gap - Date.now();
  lastSearchAt.set(engine, Date.now() + Math.max(0, wait));
  if (wait > 12_000) {
    throw new Error(
      `${engineName(engine)} 需要间隔 ${Math.ceil(wait / 1000)} 秒，避免触发验证。可以改用 IQDB。`,
    );
  }
  if (wait > 0) await sleep(wait);
}

async function postForm(
  url: string,
  form: FormData,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; json: unknown; setCookies: string[] }> {
  async function once(init?: { timeoutMs: number }): Promise<Response> {
    return outboundFetch(url, {
      method: "POST",
      headers,
      body: form,
      redirect: "follow",
      ...(init ? { signal: AbortSignal.timeout(init.timeoutMs) } : {}),
    });
  }
  let res: Response;
  try {
    res = await once();
  } catch (err) {
    // curl 降级通道对部分搜源站（如 iqdb）会半途断流——curl 28 超时 /
    // 连接被切，收到 ~2KB 就停（2026-10 实测；同图同网 undici 直连 1s
    // 完整返回）。绕开 outbound 的代理决策用原生 undici 直连重试一次：
    // TUN 环境不走代理出口通常即通。只兜搜源层（健康环记一次失败属预期）。
    const msg = err instanceof Error ? `${err.message} ${err.cause ?? ""}` : String(err);
    if (!/curl: \(28\)|timed?\s*out|Operation timeout|ECONNRESET|socket hang up/i.test(msg)) throw err;
    res = await fetch(url, {
      method: "POST",
      headers,
      body: form,
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    });
  }
  const text = await res.text();
  let json: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json") || text.startsWith("{") || text.startsWith("[")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, text, json, setCookies };
}

function asFile(bytes: Uint8Array, filename: string, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], filename, { type: type || "image/jpeg" });
}

function throwIfChallenged(engine: SearchEngine, status: number, text: string) {
  if (isBotChallenge(status, text)) throw new Error(challengeMessage(engineName(engine)));
}

async function searchSauceNao(
  file: File,
  safeMode: boolean,
  apiKey?: string,
): Promise<ReverseHit[]> {
  assertSauceNaoCool();
  const form = new FormData();
  form.set("file", file);
  // 官网默认 hide=0 展示全部高相似。hide=3 会把「疑似成人」的真匹配藏掉，
  // 只剩 40% 左右的无关图。安全模式只过滤 loli/shota 词，不让 SauceNAO 预藏。
  form.set("hide", "0");
  form.set("database", "999");
  form.set("db", "999");
  form.set("numres", "16");
  form.set("output_type", "2");
  const key = apiKey?.trim() || process.env.SAUCENAO_API_KEY?.trim() || "";
  if (key) form.set("api_key", key);
  const { status, text, json } = await postForm("https://saucenao.com/search.php", form, {
    "User-Agent": UA,
    Accept: "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    Referer: "https://saucenao.com/",
  });
  // output_type=2 的回包带 JSON 信封：官方 API 自家限流（429/-2）在信封里说，
  // 不是 Cloudflare。只有没拿到信封（HTML 页）才可能是真风控。
  const header =
    json && typeof json === "object"
      ? (json as { header?: { status?: number; message?: string } }).header
      : undefined;
  const apiError = sauceNaoApiError(header, status);
  if (apiError) throw new Error(apiError);
  if (!header) {
    // 无 JSON 信封的 403/429/挑战页：Cloudflare 浏览器验证——服务器直连
    // （fetch/curl）过不了 JS 挑战，冷却 10 分钟并在文案里把路指给其他引擎。
    if (isBotChallenge(status, text)) {
      sauceNaoCoolUntil = Date.now() + 10 * 60_000;
      throw new Error(
        "SauceNAO 开了浏览器验证（Cloudflare），服务器直连暂时过不去——10 分钟内自动跳过它。IQDB / trace.moe / ascii2d 不受影响，先用它们搜。",
      );
    }
  }
  if (status >= 400) throw new Error(`SauceNAO 请求失败（${status}）`);
  const jsonHits = json ? parseSauceNaoJson(json, safeMode) : [];
  if (jsonHits.length > 0) return jsonHits;
  if (/too small/i.test(text)) throw new Error("图片尺寸太小，换一张再试");
  if (/Daily Search Limit Exceeded|search limit/i.test(text)) {
    throw new Error("SauceNAO 今日次数用完了，换 IQDB，或在设置里填 API key");
  }
  if (/you need an image|acceptable format/i.test(text)) {
    throw new Error("SauceNAO 没吃进这张图。换 JPEG 或 PNG 再试。这不是验证码。");
  }
  if (/SauceNAO Error/i.test(text) && text.length < 2000) {
    const msg = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    throw new Error(msg.slice(0, 160) || "SauceNAO 无法处理这张图");
  }
  return parseSauceNaoHtml(text, safeMode);
}

async function searchIqdb(file: File, safeMode: boolean): Promise<ReverseHit[]> {
  const form = new FormData();
  form.set("file", file);
  const { status, text } = await postForm("https://iqdb.org/", form, {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml",
    Referer: "https://iqdb.org/",
  });
  throwIfChallenged("iqdb", status, text);
  if (status >= 400) throw new Error(`IQDB 请求失败（${status}）`);
  if (/can.?t read/i.test(text) || /could not read/i.test(text)) {
    throw new Error("IQDB 读不了这张图，换 JPEG / PNG 试试");
  }
  return parseIqdbHtml(text, safeMode);
}

async function searchTraceMoe(file: File, safeMode: boolean): Promise<ReverseHit[]> {
  const res = await outboundFetch("https://api.trace.moe/search?anilistInfo=1&cutBorders=1", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": file.type || "image/jpeg",
    },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  const text = await res.text();
  if (res.status === 402 || res.status === 429) throw new Error("trace.moe 次数用完了，过一会儿再试");
  throwIfChallenged("tracemoe", res.status, text);
  if (res.status >= 400) throw new Error(`trace.moe 请求失败（${res.status}）`);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("trace.moe 没有返回结果");
  }
  const error = typeof json === "object" && json && "error" in json ? String((json as { error?: unknown }).error ?? "") : "";
  if (error.trim()) {
    if (/quota|limit/i.test(error)) throw new Error("trace.moe 次数用完了，过一会儿再试");
    throw new Error(error.trim().slice(0, 120));
  }
  return parseTraceMoeJson(json, safeMode);
}

async function searchDanbooru(
  file: File,
  safeMode: boolean,
  account?: { login: string; apiKey: string },
): Promise<ReverseHit[]> {
  const form = new FormData();
  form.set("search[file]", file);
  const headers: Record<string, string> = {
    "User-Agent": DANBOORU_UA,
    Accept: "application/json,text/html;q=0.8",
    Referer: "https://danbooru.donmai.us/iqdb_queries",
  };
  const authorization = danbooruAuthHeader(account?.login, account?.apiKey);
  if (authorization) headers.Authorization = authorization;
  const { status, text, json } = await postForm("https://danbooru.donmai.us/iqdb_queries.json", form, headers);
  if (!authorization && (status === 403 || isBotChallenge(status, text))) {
    throw new Error("Danbooru 被人机验证拦住了。到设置填上账号后再搜，请求会带凭据，一般就不再要验证码。");
  }
  throwIfChallenged("danbooru", status, text);
  if (status >= 400) throw new Error(`Danbooru 请求失败（${status}）`);
  if (!json) throw new Error("Danbooru 没有返回相似图");
  return parseDanbooruIqdbJson(json, safeMode);
}

async function ascii2dSession(): Promise<SessionJar> {
  const cached = jars.get("ascii2d");
  if (cached && Date.now() - cached.at < JAR_TTL_MS && cached.cookie) return cached;
  const home = await outboundFetch("https://ascii2d.net/", {
    headers: { "User-Agent": UA, Accept: "text/html", Referer: "https://ascii2d.net/" },
    redirect: "follow",
  });
  const homeHtml = await home.text();
  if (isBotChallenge(home.status, homeHtml)) {
    jars.delete("ascii2d");
    coolAscii2d();
    throw new Error(challengeMessage("ascii2d"));
  }
  const fileForm = homeHtml.match(/id=["']file_upload["'][\s\S]*?<\/form>/i)?.[0] ?? homeHtml;
  const token =
    fileForm.match(/name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
    homeHtml.match(/name="csrf-token"\s+content="([^"]+)"/i)?.[1] ||
    "";
  const cookie = cookieHeader(
    typeof home.headers.getSetCookie === "function" ? home.headers.getSetCookie() : [],
  );
  const jar = { cookie, token, at: Date.now() };
  jars.set("ascii2d", jar);
  return jar;
}

async function searchAscii2d(file: File): Promise<ReverseHit[]> {
  const jar = await ascii2dSession();
  const form = new FormData();
  form.set("utf8", "✓");
  form.set("file", file);
  if (jar.token) form.set("authenticity_token", jar.token);
  const res = await outboundFetch("https://ascii2d.net/search/file", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      Referer: "https://ascii2d.net/",
      Origin: "https://ascii2d.net",
      ...(jar.cookie ? { Cookie: jar.cookie } : {}),
    },
    body: form,
    redirect: "follow",
  });
  const colorHtml = await res.text();
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (setCookies.length) {
    jars.set("ascii2d", {
      ...jar,
      cookie: mergeCookie(jar.cookie, setCookies),
      at: Date.now(),
    });
  }
  if (isBotChallenge(res.status, colorHtml)) {
    jars.delete("ascii2d");
    coolAscii2d();
    throw new Error(challengeMessage("ascii2d"));
  }
  if (res.status >= 400) throw new Error(`ascii2d 请求失败（${res.status}）`);
  const colorHits = parseAscii2dHtml(colorHtml, "色合");
  let bovwHits: ReverseHit[] = [];
  const bovwUrl = ascii2dBovwUrl(colorHtml, res.url);
  if (bovwUrl) {
    const nextJar = jars.get("ascii2d") ?? jar;
    const bovw = await outboundFetch(bovwUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: res.url || "https://ascii2d.net/",
        ...(nextJar.cookie ? { Cookie: nextJar.cookie } : {}),
      },
    });
    const bovwHtml = await bovw.text();
    if (!isBotChallenge(bovw.status, bovwHtml) && bovw.ok) {
      bovwHits = parseAscii2dHtml(bovwHtml, "特征");
    }
  }
  const seen = new Set<string>();
  const merged: ReverseHit[] = [];
  for (const hit of [...bovwHits, ...colorHits]) {
    const key = hit.workId ? `${hit.site}:${hit.workId}` : hit.sourceUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged.slice(0, 16);
}

export async function runReverseSearch(input: {
  engine: SearchEngine;
  bytes: Uint8Array;
  filename: string;
  type: string;
  safeMode: boolean;
  apiKey?: string;
  danbooru?: { login: string; apiKey: string };
}): Promise<{ engine: SearchEngine; items: ReverseHit[] }> {
  if (input.bytes.byteLength === 0) throw new Error("没有读到图片");
  if (input.bytes.byteLength > MAX_SEARCH_BYTES) throw new Error("图片超过 8 MB，请缩小后再试");
  const type = SEARCH_TYPES.has(input.type) ? input.type : "image/jpeg";
  const name = input.filename.replace(/[^\w.-]+/g, "_").slice(0, 80) || "upload.jpg";
  const file = asFile(input.bytes, name, type);
  const key = input.apiKey?.trim() || "";
  if (input.engine === "ascii2d") assertAscii2dCool();
  await pace(input.engine, Boolean(key || process.env.SAUCENAO_API_KEY?.trim()));
  if (input.engine === "iqdb") return { engine: "iqdb", items: await searchIqdb(file, input.safeMode) };
  if (input.engine === "ascii2d") return { engine: "ascii2d", items: await searchAscii2d(file) };
  if (input.engine === "tracemoe") return { engine: "tracemoe", items: await searchTraceMoe(file, input.safeMode) };
  if (input.engine === "danbooru") {
    return { engine: "danbooru", items: await searchDanbooru(file, input.safeMode, input.danbooru) };
  }
  return { engine: "saucenao", items: await searchSauceNao(file, input.safeMode, key) };
}

export async function runReverseSearchAll(input: {
  bytes: Uint8Array;
  filename: string;
  type: string;
  safeMode: boolean;
  apiKey?: string;
  danbooru?: { login: string; apiKey: string };
}): Promise<{ groups: SearchGroup[] }> {
  const groups = await Promise.all(
    SEARCH_ENGINES.map(async ({ id }): Promise<SearchGroup> => {
      try {
        const result = await runReverseSearch({ ...input, engine: id });
        return {
          engine: id,
          status: result.items.length > 0 ? "ok" : "empty",
          items: result.items,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : "搜图失败";
        return {
          engine: id,
          status: isSearchLimited(error) ? "limited" : "error",
          items: [],
          error,
        };
      }
    }),
  );
  return { groups };
}
