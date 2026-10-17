/**
 * 上游共享通道：JSON 请求 + unknown 清洗（由 upstream.server.ts 拆出，TD-01）。
 */
import { outboundFetch } from "../curl-fetch.server.ts";
import { withPixivUserId } from "../sync/browser-login.ts";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * 上游侧失败（网络 / 源站 5xx / 反爬拦截 / 数据不可解析）。
 * /api/source 据此回 502（用户态错误如「需要登录」保持 400，S7）。
 */
export class UpstreamError extends Error {
  /** 源站 HTTP 状态码（网络层失败无值）。调用方按码分支（如 X 的 401→Cookie 失效）。 */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

type UpstreamOrigin = "pixiv" | "fanbox" | "x";

const ORIGIN_LABEL: Record<UpstreamOrigin, string> = { pixiv: "Pixiv", fanbox: "FANBOX", x: "X" };

export async function upstreamJson(
  url: string,
  opts: {
    cookie?: string;
    origin: UpstreamOrigin;
    /** 站点特有头（X 的 Authorization / x-csrf-token）。晚于公共头合并，可覆盖。 */
    headers?: Record<string, string>;
    /** 请求方法（默认 GET）。X 的 guest activate 是 POST，其余上游全 GET。 */
    method?: string;
  },
): Promise<unknown> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  };
  if (opts.origin === "pixiv") {
    headers.Referer = "https://www.pixiv.net/";
    withPixivUserId(headers, opts.cookie);
  } else if (opts.origin === "x") {
    headers.Referer = "https://x.com/";
  } else {
    headers.Referer = "https://www.fanbox.cc/";
    headers.Origin = "https://www.fanbox.cc";
  }
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.headers) Object.assign(headers, opts.headers);

  const res = await outboundFetch(url, { headers, redirect: "follow", ...(opts.method ? { method: opts.method } : {}) });
  if (!res.ok) {
    // 文案保持「{站点} 请求失败（{状态码}）」全角括号格式：queue-throttle 的
    // rateLimitError 正则靠「（429）/（503）」后缀触发全局冷却，别改半角。
    throw new UpstreamError(`${ORIGIN_LABEL[opts.origin]} 请求失败（${res.status}）`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(`${ORIGIN_LABEL[opts.origin]} 返回了无法解析的数据`);
  }
}

// 四件套唯一定义在 parse.ts（TD-32）；此处原样再导出维持既有消费路径。
export { asRecord, asString, asNumber, asBool } from "../parse.ts";
