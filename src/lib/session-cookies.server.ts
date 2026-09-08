/**
 * 把 Pixiv / FANBOX 会话写成 HttpOnly Cookie。
 *
 * 作用：浏览器只提交字符串，真正的 Set-Cookie 留在服务端。
 * 用法：/api/sessions 调 kamiSessionCookies。
 */
import { fanboxSessionFrom, sanitizePixivCookie } from "./browser-login";

export type KamiSessionCookie = {
  name: "kami_pixiv" | "kami_fanbox";
  value: string;
  maxAge: number;
};

export function kamiSessionCookies(data: { pixiv?: string; fanbox?: string }): KamiSessionCookie[] {
  const pixiv = sanitizePixivCookie(data.pixiv ?? "");
  const fanbox = fanboxSessionFrom(data.fanbox, pixiv);
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
  ];
}

export function kamiSessionSetCookieHeader(cookie: KamiSessionCookie): string {
  return `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie.maxAge}`;
}
