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
import { outboundFetch } from "./curl-fetch.server";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function postForm(
  url: string,
  form: FormData,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; json: unknown }> {
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
  return { status: res.status, text, json };
}

function asFile(bytes: Uint8Array, filename: string, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], filename, { type: type || "image/jpeg" });
}

async function searchSauceNao(
  file: File,
  safeMode: boolean,
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
  const apiKey = process.env.SAUCENAO_API_KEY?.trim();
  if (apiKey) form.set("api_key", apiKey);
  const { status, text, json } = await postForm("https://saucenao.com/search.php", form, {
    "User-Agent": UA,
    Accept: "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    Referer: "https://saucenao.com/",
  });
  if (status === 403 || status === 429) throw new Error("SauceNAO 暂时限流，请稍后再试");
  if (status >= 400) throw new Error(`SauceNAO 请求失败（${status}）`);
  const jsonHits = json ? parseSauceNaoJson(json, safeMode) : [];
  if (jsonHits.length > 0) return jsonHits;
  if (json && typeof json === "object") {
    const header = (json as { header?: { message?: string; status?: number } }).header;
    if (header?.status && header.status < 0 && header.message) {
      if (!/anonymous account type does not permit API/i.test(header.message)) {
        throw new Error(header.message);
      }
    }
  }
  if (/too small/i.test(text)) throw new Error("图片尺寸太小，换一张再试");
  if (/Daily Search Limit Exceeded|search limit/i.test(text)) {
    throw new Error("SauceNAO 今日次数用完了，换 IQDB 或 TinEye，或明天再试");
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
  if (status >= 400) throw new Error(`IQDB 请求失败（${status}）`);
  if (/can.?t read/i.test(text) || /could not read/i.test(text)) {
    throw new Error("IQDB 读不了这张图，换 JPEG / PNG 试试");
  }
  return parseIqdbHtml(text, safeMode);
}

async function searchAscii2d(file: File): Promise<ReverseHit[]> {
  const home = await outboundFetch("https://ascii2d.net/", {
    headers: { "User-Agent": UA, Accept: "text/html", Referer: "https://ascii2d.net/" },
    redirect: "follow",
  });
  const homeHtml = await home.text();
  const fileForm = homeHtml.match(/id=["']file_upload["'][\s\S]*?<\/form>/i)?.[0] ?? homeHtml;
  const token =
    fileForm.match(/name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
    homeHtml.match(/name="csrf-token"\s+content="([^"]+)"/i)?.[1] ||
    "";
  const cookie = cookieHeader(
    typeof home.headers.getSetCookie === "function" ? home.headers.getSetCookie() : [],
  );
  const form = new FormData();
  form.set("utf8", "✓");
  form.set("file", file);
  if (token) form.set("authenticity_token", token);
  const res = await outboundFetch("https://ascii2d.net/search/file", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      Referer: "https://ascii2d.net/",
      Origin: "https://ascii2d.net",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form,
    redirect: "follow",
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error("ascii2d 暂时限流或要过人机验证，请稍后再试");
  }
  if (res.status >= 400) throw new Error(`ascii2d 请求失败（${res.status}）`);
  const colorHtml = await res.text();
  if (/cloudflare|cf-challenge|just a moment/i.test(colorHtml)) {
    throw new Error("ascii2d 触发了验证，请稍后再试");
  }
  const colorHits = parseAscii2dHtml(colorHtml, "色合");
  let bovwHits: ReverseHit[] = [];
  const bovwUrl = ascii2dBovwUrl(colorHtml, res.url);
  if (bovwUrl) {
    const bovw = await outboundFetch(bovwUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: res.url || "https://ascii2d.net/",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (bovw.ok) bovwHits = parseAscii2dHtml(await bovw.text(), "特征");
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
  if (status === 403 || status === 429) throw new Error("TinEye 暂时限流或需要验证，请稍后再试");
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
}): Promise<{ engine: SearchEngine; items: ReverseHit[] }> {
  if (input.bytes.byteLength === 0) throw new Error("没有读到图片");
  if (input.bytes.byteLength > MAX_SEARCH_BYTES) throw new Error("图片超过 8 MB，请缩小后再试");
  const type = SEARCH_TYPES.has(input.type) ? input.type : "image/jpeg";
  const name = input.filename.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "upload.jpg";
  const file = asFile(input.bytes, name, type);
  if (input.engine === "iqdb") return { engine: "iqdb", items: await searchIqdb(file, input.safeMode) };
  if (input.engine === "tineye") return { engine: "tineye", items: await searchTinEye(file) };
  if (input.engine === "ascii2d") return { engine: "ascii2d", items: await searchAscii2d(file) };
  return { engine: "saucenao", items: await searchSauceNao(file, input.safeMode) };
}
