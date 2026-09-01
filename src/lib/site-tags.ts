/**
 * 各站标签怎么写、怎么搜、怎么存。
 *
 * 作用：把「点一个 tag 去搜索 / 保存快捷标签」收成同一套规则。
 * 用法：canonicalTag 入库和发请求；displayTag 给人看；tagHint 写在搜索框下。
 * 为什么：Pixiv / 图站空格=同时包含多个标签；点单个标签才走精确匹配。
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

export function splitSearchTags(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|([^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const tag = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (tag) out.push(tag);
  }
  return out;
}

export function joinSearchTags(tags: readonly string[]): string {
  return tags.filter(Boolean).join(" ");
}

export function canonicalTag(source: Source, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (source === "fanbox") {
    return (splitSearchTags(trimmed)[0] ?? trimmed).slice(0, 80);
  }
  if (isBooru(source)) {
    return splitSearchTags(trimmed)
      .map((part) =>
        part
          .replace(/\s+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toLowerCase(),
      )
      .filter(Boolean)
      .slice(0, 6)
      .join(" ");
  }
  return joinSearchTags(splitSearchTags(trimmed)).slice(0, 200);
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
      return "Pixiv：空格拆成多个标签（并且）。点单个标签仍是精确匹配。";
    case "fanbox":
      return "FANBOX：一次搜索一个标签。";
    case "yande":
    case "konachan":
      return "图站：空格拆成多个标签（并且）。标签里的空格写成下划线，例如 hatsune_miku。";
    case "danbooru":
      return "Danbooru：空格=并且。未登录最多两个标签（安全模式会占一个 rating）。";
  }
}

export function tagPlaceholder(source: Source): string {
  switch (source) {
    case "pixiv":
      return "多个标签用空格分开，或粘贴作品 / 画师链接";
    case "fanbox":
      return "搜索一个标签，或输入创作者 ID / 链接";
    case "yande":
    case "konachan":
    case "danbooru":
      return "多个标签用空格分开（空格写成 _ ），或粘贴作品链接";
  }
}

export function isSavedTag(list: readonly string[], source: Source, raw: string): boolean {
  const tag = canonicalTag(source, raw);
  return Boolean(tag) && list.includes(tag);
}
