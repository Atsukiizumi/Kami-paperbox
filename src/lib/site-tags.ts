/**
 * 各站标签怎么写、怎么搜、怎么存。
 *
 * 作用：把「点一个 tag 去搜索 / 保存快捷标签」收成同一套规则。
 * 用法：canonicalTag 入库和发请求；displayTag 给人看；tagHint 写在搜索框下。
 * 为什么：Pixiv 一个词（空格=同时包含，点标签用精确匹配）；
 *        Yande / Konachan / Danbooru 空格是 AND，标签里的空格写成下划线；
 *        FANBOX 接口一次只吃一个标签。混用会搜空。
 */
import type { Source } from "./types";

const SOURCES: readonly Source[] = ["pixiv", "fanbox", "yande", "konachan", "danbooru"];

function isBooru(source: Source): boolean {
  return source === "yande" || source === "konachan" || source === "danbooru";
}

export const MAX_SAVED_TAGS = 24;

export function emptySavedTags(): Record<Source, string[]> {
  return { pixiv: [], fanbox: [], yande: [], konachan: [], danbooru: [] };
}

export function parseSavedTags(raw: unknown): Record<Source, string[]> {
  const out = emptySavedTags();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  for (const site of SOURCES) {
    const list = rec[site];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    for (const item of list) {
      if (typeof item !== "string") continue;
      const tag = canonicalTag(site, item);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out[site].push(tag);
      if (out[site].length >= MAX_SAVED_TAGS) break;
    }
  }
  return out;
}

export function canonicalTag(source: Source, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isBooru(source)) {
    return trimmed
      .split(/[\s,]+/)
      .map((part) => part.replace(/_+/g, "_").replace(/^_+|_+$/g, "").toLowerCase())
      .filter(Boolean)
      .slice(0, 6)
      .join(" ");
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 80);
}

export function displayTag(source: Source, tag: string): string {
  if (!isBooru(source)) return tag;
  return tag
    .split(/\s+/)
    .map((part) => part.replace(/_/g, " "))
    .join(" · ");
}

export function tagEquals(source: Source, a: string, b: string): boolean {
  return canonicalTag(source, a) === canonicalTag(source, b);
}

export function toggleSavedTag(list: readonly string[], source: Source, raw: string): string[] {
  const tag = canonicalTag(source, raw);
  if (!tag) return [...list];
  if (list.some((item) => item === tag)) return list.filter((item) => item !== tag);
  return [tag, ...list.filter((item) => item !== tag)].slice(0, MAX_SAVED_TAGS);
}

export function tagHint(source: Source): string {
  switch (source) {
    case "pixiv":
      return "Pixiv：点标签是精确匹配；搜索框里空格表示同时包含这些词。";
    case "fanbox":
      return "FANBOX：一次搜索一个标签。";
    case "yande":
    case "konachan":
      return "图站：空格表示并且。标签里的空格写成下划线，例如 hatsune_miku。";
    case "danbooru":
      return "Danbooru：一次只用一个主标签（安全模式会自动加 rating:g）。空格写成下划线。";
  }
}

export function tagPlaceholder(source: Source): string {
  switch (source) {
    case "pixiv":
      return "搜索标签（空格=同时包含），或粘贴作品 / 画师链接";
    case "fanbox":
      return "搜索一个标签，或输入创作者 ID / 链接";
    case "yande":
    case "konachan":
    case "danbooru":
      return "搜索标签，空格=并且（空格写成 _ ），或粘贴作品链接";
  }
}

export function isSavedTag(list: readonly string[], source: Source, raw: string): boolean {
  const tag = canonicalTag(source, raw);
  return Boolean(tag) && list.includes(tag);
}
