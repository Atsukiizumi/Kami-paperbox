import {
  MAX_SEARCH_BYTES,
  SEARCH_TYPES,
  type ReverseHit,
  type SearchEngine,
  ascii2dBovwUrl,
  parseAscii2dHtml,
  parseIqdbHtml,
  parseSauceNaoHtml,
  parseSauceNaoJson,
  parseTinEyeJson,
} from "./reverse-search";
import {
  challengeMessage,
  isBotChallenge,
  searchGapMs,
} from "./reverse-search-guard";
import { outboundFetch } from "./curl-fetch.server";
import { sleep } from "./utils";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const lastSearchAt = new Map<SearchEngine, number>();

type SessionJar = { cookie: string; token: string; at: number };
const jars = new Map<string, SessionJar>();
const JAR_TTL_MS = 8 * 60 * 1000;

function engineName(engine: SearchEngine): string {
  if (engine === "saucenao") return "SauceNAO";
  if (engine === "ascii2d") return "ascii2d";
  if (engine === "tineye") return "TinEye";
  return "IQDB";
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
  const gap = searchGapMs(engine, hasApiKey);
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
  const res = await outboundFetch(url, {
    method: "POST",
    headers,
    body: form,
    redirect: "follow",
  });
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
  throwIfChallenged("saucenao", status, text);
  if (status >= 400) throw new Error(`SauceNAO 请求失败（${status}）`);
  const jsonHits = json ? parseSauceNaoJson(json, safeMode) : [];
  if (jsonHits.length > 0) return jsonHits;
  if (json && typeof json === "object") {
    const header = (json as { header?: { message?: string; status?: number } }).header;
    if (header?.status && header.status < 0 && header.message) {
      if (/limit/i.test(header.message)) {
        throw new Error("SauceNAO 今日次数用完了，换 IQDB，或填 API key 后再试");
      }
      if (!/anonymous account type does not permit API/i.test(header.message)) {
        throw new Error(header.message);
      }
    }
  }
  if (/too small/i.test(text)) throw new Error("图片尺寸太小，换一张再试");
  if (/Daily Search Limit Exceeded|search limit/i.test(text)) {
    throw new Error("SauceNAO 今日次数用完了，换 IQDB 或 TinEye，或填 API key");
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

async function searchTinEye(file: File): Promise<ReverseHit[]> {
  const csrfRes = await outboundFetch("https://tineye.com/api/v1/auth_csrf_token", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const csrfText = await csrfRes.text();
  if (isBotChallenge(csrfRes.status, csrfText)) throw new Error(challengeMessage("TinEye"));
  const cookie = cookieHeader(
    typeof csrfRes.headers.getSetCookie === "function" ? csrfRes.headers.getSetCookie() : [],
  );
  const form = new FormData();
  form.set("image", file);
  const { status, json, text } = await postForm("https://tineye.com/api/v1/result_json/", form, {
    "User-Agent": UA,
    Accept: "application/json",
    Referer: "https://tineye.com/",
    Origin: "https://tineye.com",
    ...(cookie ? { Cookie: cookie } : {}),
  });
  throwIfChallenged("tineye", status, text);
  if (status >= 400) throw new Error(`TinEye 请求失败（${status}）`);
  if (!json) throw new Error(text.slice(0, 120) || "TinEye 没有返回结果");
  return parseTinEyeJson(json);
}

export async function runReverseSearch(input: {
  engine: SearchEngine;
  bytes: Uint8Array;
  filename: string;
  type: string;
  safeMode: boolean;
  apiKey?: string;
}): Promise<{ engine: SearchEngine; items: ReverseHit[] }> {
  if (input.bytes.byteLength === 0) throw new Error("没有读到图片");
  if (input.bytes.byteLength > MAX_SEARCH_BYTES) throw new Error("图片超过 8 MB，请缩小后再试");
  const type = SEARCH_TYPES.has(input.type) ? input.type : "image/jpeg";
  const name = input.filename.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "upload.jpg";
  const file = asFile(input.bytes, name, type);
  const key = input.apiKey?.trim() || "";
  await pace(input.engine, Boolean(key || process.env.SAUCENAO_API_KEY?.trim()));
  if (input.engine === "iqdb") return { engine: "iqdb", items: await searchIqdb(file, input.safeMode) };
  if (input.engine === "tineye") return { engine: "tineye", items: await searchTinEye(file) };
  if (input.engine === "ascii2d") return { engine: "ascii2d", items: await searchAscii2d(file) };
  return { engine: "saucenao", items: await searchSauceNao(file, input.safeMode, key) };
}
