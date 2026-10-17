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

/**
 * 全部数据源（含 x）。SITE_LIST 只列浏览站（X 不是浏览站，入口在画师页关联，
 * design D2）；纸匣筛选、看过历史这类「按 Source 全集」渲染的地方用这张表。
 */
export const ALL_SOURCES: readonly Source[] = ["pixiv", "fanbox", "yande", "konachan", "danbooru", "x"];

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
  // x 不在 SITE_LIST（浏览切换），但纸匣筛选 / 看过历史要显示站点名
  if (source === "x") return "X";
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
  // x 不走服务端 safe 过滤（时间线敏感标注在映射层），但 Record<Source> 要有这格，
  // 值回安全侧：客户端查询键带 safeModeBySite.x，改设置不裂缓存。
  out.x = typeof rec.x === "boolean" ? rec.x : fallback;
  return out;
}

/**
 * 从 Work.author（X 作品 =「显示名@handle」）回收 X handle。
 * 映射层把 handle 藏在 author 尾巴（authorId 是 restId 身份键，不挪用），
 * workOriginUrl 造原推链接时用它取。
 */
export function xHandleFromAuthor(author: string): string | undefined {
  const hits = [...author.matchAll(/@([A-Za-z0-9_]{1,15})/g)];
  const last = hits.at(-1);
  return last?.[1];
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
    case "x": {
      // 第三参收 handle（fanbox 的 creatorId 同款用法；调用方从 work.author 取，
      // 见 xHandleFromAuthor）。传了 restId（纯数字，非 handle 形态）或空值时退
      // intent 链接——X 会 302 到带 handle 的规范地址。
      const handle = /^[A-Za-z0-9_]{1,15}$/.test(authorId) && !/^\d+$/.test(authorId) ? authorId : "";
      return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;
    }
  }
}
