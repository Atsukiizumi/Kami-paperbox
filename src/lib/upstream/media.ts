/**
 * 图片媒体代理：白名单解析 + 盘缓存 + 单飞去重 + 流式上限
 * （由 upstream.server.ts 拆出，TD-01）。SEC-08 注：isPrivateIp 的正则
 * 不覆盖 IPv6 映射 / 十进制字面量 / 解析到内网的域名——真正的防线是
 * MEDIA_HOSTS 白名单（放宽白名单前必须先把这里改成解析后判断）。
 */
import { closeOnAbort, isAbortError } from "../abort.ts";
import { danbooruAuthHeader, DANBOORU_UA } from "../booru.ts";
import { outboundFetch } from "../curl-fetch.server.ts";
import { fanboxCookieHeader, pixivUserIdFromCookie } from "../sync/browser-login.ts";
import { sleep, withMediaGate } from "../media-gate.ts";
import { getThrottle } from "../throttle.server.ts";
import { isDiskCacheableMedia, readCachedMedia, sniffMediaType, writeCachedMedia } from "../storage/media-cache.server.ts";
import { UA } from "./http.ts";

const MEDIA_HOSTS = new Set([
  "i.pximg.net",
  "s.pximg.net",
  "pixiv.pximg.net",
  "downloads.fanbox.cc",
  "files.yande.re",
  "assets.yande.re",
  "yande.re",
  "konachan.com",
  "konachan.net",
  "cdn.donmai.us",
  "danbooru.donmai.us",
]);

const MEDIA_SUFFIXES = [
  "pximg.net",
  "fanbox.cc",
  "yande.re",
  "konachan.com",
  "konachan.net",
  "donmai.us",
  "saucenao.com",
  "iqdb.org",
  "ascii2d.net",
];

const MAX_MEDIA_BYTES = 48 * 1024 * 1024;
const MEDIA_CACHE = "public, max-age=604800, stale-while-revalidate=86400, immutable";

function mediaOutHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": MEDIA_CACHE,
    "X-Content-Type-Options": "nosniff",
  };
}

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  return false;
}

function isPrivateIp(host: string): boolean {
  if (/^127\./.test(host) || host === "0.0.0.0") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

export function parseAllowedMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("无效的图片地址");
  }
  if (url.protocol !== "https:") throw new Error("只允许 https 资源");
  if (url.username || url.password) throw new Error("非法地址");
  const host = url.hostname.toLowerCase();
  if (isPrivateHostname(host) || isPrivateIp(host)) throw new Error("非法地址");
  if (MEDIA_HOSTS.has(host)) return url;
  if (MEDIA_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return url;
  throw new Error("不支持的图片来源");
}

function mediaFromDisk(url: URL): Response | null {
  if (!isDiskCacheableMedia(url)) return null;
  const hit = readCachedMedia(url.toString());
  if (!hit) return null;
  return new Response(Buffer.from(hit.bytes), { status: 200, headers: mediaOutHeaders(hit.type) });
}

function rememberMedia(url: URL, bytes: Uint8Array, type: string) {
  if (!isDiskCacheableMedia(url)) return;
  writeCachedMedia(url.toString(), bytes, type);
}

// PER-4：同 URL 并发（多卡片同图）只打一次上游，各调用方拿 clone 互不干扰。
// 共享请求绑定首个调用方的 signal：被其 abort 掐断时，其余调用方自拉一次。
// TD-40：单飞键带凭据指纹——访客层开放后访客与登录用户并发同图，裸 URL 共享
// 会让后来者拿到前者凭据的结果。指纹只区分到「账号」（pixiv/fanbox 用户 id +
// danbooru login），同账号并发仍共享；cookie 原文不进键。盘缓存路径不带 cookie。
const inflightMedia = new Map<string, Promise<Response>>();

function inflightKey(
  rawUrl: string,
  cookies: {
    pixiv?: string;
    fanbox?: string;
    danbooru?: { login: string };
  },
): string {
  const uid =
    pixivUserIdFromCookie(cookies.pixiv) ?? pixivUserIdFromCookie(cookies.fanbox) ?? "guest";
  const danbooru = cookies.danbooru?.login ?? "";
  return `${rawUrl}|${uid}|${danbooru}`;
}

export function fetchMediaResponse(
  rawUrl: string,
  cookies: {
    pixiv?: string;
    fanbox?: string;
    /** Danbooru 账号。cdn.donmai.us 的图也要过 Cloudflare，带账号请求可免验证。 */
    danbooru?: { login: string; apiKey: string };
  },
  signal?: AbortSignal,
  retried = false,
): Promise<Response> {
  if (signal?.aborted) return Promise.resolve(new Response(null, { status: 204 }));
  const key = inflightKey(rawUrl, cookies);
  const shared = inflightMedia.get(key);
  if (shared) {
    return shared.then(
      (res) => res.clone(),
      (err) => {
        if (!retried && isAbortError(err) && !signal?.aborted) {
          return fetchMediaResponse(rawUrl, cookies, signal, true);
        }
        throw err;
      },
    );
  }
  const load = loadMediaResponse(rawUrl, cookies, signal);
  inflightMedia.set(key, load);
  return load.then(
    (res) => {
      inflightMedia.delete(key);
      return res.clone();
    },
    (err) => {
      inflightMedia.delete(key);
      throw err;
    },
  );
}

/** PER-5：无 Content-Length 的流式转发累计超限即断流（pipeTo 默认连带取消上游读取）。 */
function capStreamBytes(body: ReadableStream<Uint8Array>, capBytes: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > capBytes) throw new Error("file too large");
        controller.enqueue(chunk);
      },
    }),
  );
}

async function loadMediaResponse(
  rawUrl: string,
  cookies: {
    pixiv?: string;
    fanbox?: string;
    /** Danbooru 账号。cdn.donmai.us 的图也要过 Cloudflare，带账号请求可免验证。 */
    danbooru?: { login: string; apiKey: string };
  },
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) return new Response(null, { status: 204 });
  const url = parseAllowedMediaUrl(rawUrl);
  const cached = mediaFromDisk(url);
  if (cached) return cached;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "image/avif,image/webp,image/gif,image/*,application/zip,application/octet-stream,*/*;q=0.8",
  };
  const host = url.hostname.toLowerCase();
  if (host.endsWith("pximg.net")) {
    headers.Referer = "https://www.pixiv.net/";
  } else if (host === "yande.re" || host.endsWith(".yande.re")) {
    headers.Referer = "https://yande.re/";
  } else if (host.endsWith("konachan.com") || host.endsWith("konachan.net")) {
    headers.Referer = "https://konachan.com/";
  } else if (host.endsWith("donmai.us")) {
    headers.Referer = "https://danbooru.donmai.us/";
    headers["User-Agent"] = DANBOORU_UA;
    const authorization = danbooruAuthHeader(cookies.danbooru?.login, cookies.danbooru?.apiKey);
    if (authorization) headers.Authorization = authorization;
    const { curlFetch } = await import("../curl-fetch.server");
    const res = await curlFetch(url.toString(), headers);
    if (res.status < 200 || res.status >= 300) {
      return new Response("upstream error", { status: res.status === 404 ? 404 : 502 });
    }
    if (res.body.byteLength > MAX_MEDIA_BYTES) {
      return new Response("file too large", { status: 413 });
    }
    const body = new Uint8Array(res.body);
    const type = sniffMediaType(body, res.contentType);
    rememberMedia(url, body, type);
    return new Response(Buffer.from(body), {
      status: 200,
      headers: mediaOutHeaders(type),
    });
  } else if (host.endsWith("ascii2d.net")) {
    headers.Referer = "https://ascii2d.net/";
  } else if (host.endsWith("saucenao.com")) {
    headers.Referer = "https://saucenao.com/";
  } else if (host.endsWith("iqdb.org")) {
    headers.Referer = "https://iqdb.org/";
  } else {
    headers.Referer = "https://www.fanbox.cc/";
    headers.Origin = "https://www.fanbox.cc";
    const c = fanboxCookieHeader(cookies.fanbox, cookies.pixiv);
    if (c) headers.Cookie = c;
  }

  const gated = host.endsWith("pximg.net") || host.endsWith("fanbox.cc");
  const throttle = getThrottle();
  const pull = () => outboundFetch(url.toString(), { headers, redirect: "follow", signal });
  const run = () => (gated ? withMediaGate(pull, signal, throttle.mediaConcurrency) : pull());
  let res = await run();
  if (signal?.aborted) return new Response(null, { status: 204 });
  let attempt = 0;
  while (!res.ok && (res.status === 429 || res.status === 503) && attempt < throttle.mediaRetry) {
    attempt += 1;
    await sleep(throttle.mediaRetryMs * attempt, signal);
    res = await run();
    if (signal?.aborted) return new Response(null, { status: 204 });
  }
  if (signal?.aborted) return new Response(null, { status: 204 });
  if (!res.ok) {
    return new Response("upstream error", { status: res.status === 404 ? 404 : 502 });
  }
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_MEDIA_BYTES) {
    return new Response("file too large", { status: 413 });
  }
  const declared = res.headers.get("content-type") || "application/octet-stream";
  const cacheable = isDiskCacheableMedia(url);
  if (!cacheable && res.body && (length === 0 || length <= MAX_MEDIA_BYTES)) {
    return new Response(capStreamBytes(closeOnAbort(res.body, signal), MAX_MEDIA_BYTES), {
      status: 200,
      headers: mediaOutHeaders(declared),
    });
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (signal?.aborted) return new Response(null, { status: 204 });
  if (buf.byteLength > MAX_MEDIA_BYTES) {
    return new Response("file too large", { status: 413 });
  }
  const contentType = sniffMediaType(buf, declared);
  rememberMedia(url, buf, contentType);
  return new Response(Buffer.from(buf), {
    status: 200,
    headers: mediaOutHeaders(contentType),
  });
}
