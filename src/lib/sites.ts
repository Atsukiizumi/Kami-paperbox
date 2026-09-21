/**
 * 站点枚举和原站链接。
 *
 * 作用：顶栏切换、作品「原始链接」、判断是不是图站。
 * 用法：siteLabel(source)、workOriginUrl(source, id, authorId)。
 * 为什么：FANBOX 创作者链接要用 creatorId（authorId），不能只用数字 id。
 */
import type { BooruSite, Source } from "./types.ts";

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

/**
 * 每站点安全模式（true = 隐藏该站 R-18）。
 *
 * 记录缺站点 / 值非法时补 fallback：fallback 来自旧版全局 safeMode（迁移、
 * 旧备份），两端一致——没有记录的一律回到安全侧。
 */
export function parseSafeModeBySite(raw: unknown, fallback = true): Record<Source, boolean> {
  const rec = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = {} as Record<Source, boolean>;
  for (const site of SITE_LIST) {
    const v = rec[site.id];
    out[site.id] = typeof v === "boolean" ? v : fallback;
  }
  return out;
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
