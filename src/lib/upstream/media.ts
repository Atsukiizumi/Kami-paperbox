/**
 * 图片媒体代理：白名单解析 + 盘缓存 + 单飞去重 + 流式上限
 * （由 upstream.server.ts 拆出，TD-01）。SEC-08 前置修复：私网判断在
 * media-host-guard.server.ts——IP 字面量（含 IPv6 映射 / 整数写法）同步判，
 * 域名解析后逐 IP 判（带 TTL 缓存）；白名单用精确子域集，不再放行任意后缀。
 */
import { closeOnAbort, isAbortError } from "../abort.ts";
import { danbooruAuthHeader, DANBOORU_UA } from "../booru.ts";
import { outboundFetch } from "../curl-fetch.server.ts";
import { fanboxCookieHeader, pixivUserIdFromCookie } from "../sync/browser-login.ts";
import { sleep, withMediaGate } from "../media-gate.ts";
import { getThrottle } from "../throttle.server.ts";
import { getActiveProxy } from "../proxy.server.ts";
import { isDiskCacheableMedia, readCachedMedia, sniffMediaType, writeCachedMedia } from "../storage/media-cache.server.ts";
import { UA } from "./http.ts";
import {
  assertHostResolvesPublicly,
  isPrivateHostname,
  isPrivateIpLiteral,
  normalizeIpLiteral,
} from "./media-host-guard.server.ts";

/**
 * 精确子域白名单（SEC-08：曾用 MEDIA_SUFFIXES 后缀匹配放行任意子域）。
 * 集合来自仓库取证——mapping.test.ts 固定样本、各处测试 fixture 与运行时常量：
 * - pximg：pixiv 媒体只出 i / s / pixiv 三台（fixtures 全量命中）
 * - fanbox：投稿图 / 附件 / 封面全在 downloads；www / api / 名称.fanbox.cc 是
 *   页面与 API 域，从来不是媒体域（fanbox.cc 是开放子域面，收紧即目的）
 * - yande.re：正文图 files、静态 assets、旧预览走主域
 * - konachan：主站与全年龄镜像都在主域出图（booru-sites.ts 的镜像兜底同域）
 * - donmai：图在 cdn，主域直出也要留（ Referer/Authorization 逻辑引用 danbooru.donmai.us）
 * - saucenao：结果缩略图在 img1（fixture 取证）；img2 / img3 是同站负载均衡
 *   别名，一并放行。残余风险：若引擎将来启用 img4+，需在此扩集（走 docs/04
 *   §4.10「新站点加白名单」同一条人工流程）——不做通配，避免回到任意子域放行
 * - iqdb / ascii2d：缩略图与结果都在主域（reverse-search.ts absUrl 锚主域）
 */
const MEDIA_HOSTS = new Set([
  "i.pximg.net",
  "s.pximg.net",
  "pixiv.pximg.net",
  "downloads.fanbox.cc",
  "yande.re",
  "files.yande.re",
  "assets.yande.re",
  "konachan.com",
  "konachan.net",
  "danbooru.donmai.us",
  "cdn.donmai.us",
  "saucenao.com",
  "img1.saucenao.com",
  "img2.saucenao.com",
  "img3.saucenao.com",
  "iqdb.org",
  "ascii2d.net",
]);

const MAX_MEDIA_BYTES = 48 * 1024 * 1024;
const MEDIA_CACHE = "public, max-age=604800, stale-while-revalidate=86400, immutable";

function mediaOutHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": MEDIA_CACHE,
    "X-Content-Type-Options": "nosniff",
  };
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
  // 整数写法（2130706433 / 0x7f.1 等）先折叠成点分 IPv4 再判私网；白名单域
  // 都以字母结尾，归一对它们是恒等变换，不会误伤。url.hostname 对 IPv6
  // 保留方括号（[::1]），判私网前必须剥掉。
  const host = normalizeIpLiteral(url.hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1"));
  if (isPrivateHostname(host) || isPrivateIpLiteral(host)) throw new Error("非法地址");
  if (!MEDIA_HOSTS.has(host)) throw new Error("不支持的图片来源");
  return url;
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
  // SEC-08：白名单域还要「解析后判断」——解析出私网 IP（DNS rebinding 面）
  // 就拒。fail-open 取舍与 5min TTL 缓存见 media-host-guard.server.ts。
  // 出站配了代理时整道闸跳过：连接经代理由代理侧解析，本机 DNS 答案
  // （含 fake-ip 映射、DNS 污染结果）不代表连接目标，判了只会误伤。
  if (!getActiveProxy() && !(await assertHostResolvesPublicly(url.hostname.toLowerCase()))) {
    throw new Error("非法地址");
  }
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
