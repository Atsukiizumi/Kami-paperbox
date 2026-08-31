/**
 * 站点枚举和原站链接。
 *
 * 作用：顶栏切换、作品「原始链接」、判断是不是图站。
 * 用法：siteLabel(source)、workOriginUrl(source, id, authorId)。
 * 为什么：FANBOX 创作者链接要用 creatorId（authorId），不能只用数字 id。
 */
import type { BooruSite, Source } from "./types";

export const SITE_LIST = [
  { id: "pixiv", label: "Pixiv" },
  { id: "fanbox", label: "FANBOX" },
  { id: "yande", label: "Yande" },
  { id: "konachan", label: "Konachan" },
  { id: "danbooru", label: "Danbooru" },
] as const satisfies ReadonlyArray<{ id: Source; label: string }>;

export const BOORU_SITES: readonly BooruSite[] = ["yande", "konachan", "danbooru"];

export function isBooru(source: string): source is BooruSite {
  return source === "yande" || source === "konachan" || source === "danbooru";
}

export function isSource(value: string): value is Source {
  return SITE_LIST.some((s) => s.id === value);
}

export function parseSource(value: string): Source {
  return isSource(value) ? value : "pixiv";
}

export function siteLabel(source: Source): string {
  return SITE_LIST.find((s) => s.id === source)?.label ?? source;
}

export function workOriginUrl(source: Source, id: string, authorId = ""): string {
  switch (source) {
    case "pixiv":
      return `https://www.pixiv.net/artworks/${id}`;
    case "fanbox":
      return `https://${authorId || "www"}.fanbox.cc/posts/${id}`;
    case "yande":
      return `https://yande.re/post/show/${id}`;
    case "konachan":
      return `https://konachan.com/post/show/${id}`;
    case "danbooru":
      return `https://danbooru.donmai.us/posts/${id}`;
  }
}
