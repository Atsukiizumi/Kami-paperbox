/**
 * 把 Pixiv / FANBOX / X 会话写成 HttpOnly Cookie。
 *
 * 作用：浏览器只提交字符串，真正的 Set-Cookie 留在服务端。
 * 用法：/api/sessions 调 kamiSessionCookies。X 镜像（kami_x）由 /api/source
 *      读回兜底；/api/media 不读——twimg 免登录，X Cookie 不进媒体代理。
 */
import { fanboxSessionFrom, sanitizePixivCookie } from "./browser-login.ts";
import { sanitizeXCookie } from "../x-settings.ts";

export type KamiSessionCookie = {
  name: "kami_pixiv" | "kami_fanbox" | "kami_danbooru" | "kami_x";
  value: string;
  maxAge: number;
};

export function kamiSessionCookies(data: {
  pixiv?: string;
  fanbox?: string;
  /** X 会话 Cookie 原文（auth_token=…; ct0=…），经 sanitizeXCookie 规范化后落镜像。 */
  x?: string;
  danbooruLogin?: string;
  danbooruApiKey?: string;
}): KamiSessionCookie[] {
  const pixiv = sanitizePixivCookie(data.pixiv ?? "");
  const fanbox = fanboxSessionFrom(data.fanbox, pixiv);
  const x = sanitizeXCookie(data.x);
  const danbooru =
    data.danbooruLogin && data.danbooruApiKey
      ? encodeURIComponent(JSON.stringify({ login: data.danbooruLogin, apiKey: data.danbooruApiKey }))
      : "";
  return [
    {
      name: "kami_pixiv",
      value: pixiv ? encodeURIComponent(pixiv) : "",
      maxAge: pixiv ? 2592000 : 0,
    },
    {
      name: "kami_fanbox",
      value: fanbox ? encodeURIComponent(fanbox) : "",
      maxAge: fanbox ? 2592000 : 0,
    },
    {
      name: "kami_danbooru",
      value: danbooru,
      maxAge: danbooru ? 2592000 : 0,
    },
    {
      name: "kami_x",
      value: x ? encodeURIComponent(x) : "",
      maxAge: x ? 2592000 : 0,
    },
  ];
}

export function kamiSessionSetCookieHeader(cookie: KamiSessionCookie): string {
  return `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie.maxAge}`;
}
