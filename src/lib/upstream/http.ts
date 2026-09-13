/**
 * 上游共享通道：JSON 请求 + unknown 清洗（由 upstream.server.ts 拆出，TD-01）。
 */
import { outboundFetch } from "../curl-fetch.server.ts";
import { withPixivUserId } from "../browser-login.ts";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * 上游侧失败（网络 / 源站 5xx / 反爬拦截 / 数据不可解析）。
 * /api/source 据此回 502（用户态错误如「需要登录」保持 400，S7）。
 */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function upstreamJson(
  url: string,
  opts: { cookie?: string; origin: "pixiv" | "fanbox" },
): Promise<unknown> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  };
  if (opts.origin === "pixiv") {
    headers.Referer = "https://www.pixiv.net/";
    withPixivUserId(headers, opts.cookie);
  } else {
    headers.Referer = "https://www.fanbox.cc/";
    headers.Origin = "https://www.fanbox.cc";
  }
  if (opts.cookie) headers.Cookie = opts.cookie;

  const res = await outboundFetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new UpstreamError(
      opts.origin === "pixiv"
        ? `Pixiv 请求失败（${res.status}）`
        : `FANBOX 请求失败（${res.status}）`,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(`${opts.origin === "pixiv" ? "Pixiv" : "FANBOX"} 返回了无法解析的数据`);
  }
}

// 四件套唯一定义在 parse.ts（TD-32）；此处原样再导出维持既有消费路径。
export { asRecord, asString, asNumber, asBool } from "../parse.ts";
