/**
 * 搜索联想：解析上游补全 JSON，拼当前输入。
 *
 * 作用：Pixiv / 图站边打边出标签；图站只补最后一个词。
 * 用法：parsePixivSuggest / parseBooruSuggest；suggestPrefix + applySuggest 给输入框。
 * 为什么：各站补全 JSON 形状不同，收成 { tag, extra } 再给下拉。
 */
import { hasBlockedTags, splitTags } from "./booru.ts";
import { isBooru } from "./sites.ts";
import type { BooruSite, Source, TagSuggestItem } from "./types.ts";

export type { TagSuggestItem };

const MAX = 8;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function formatCount(n: number): string | undefined {
  if (n <= 0) return undefined;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function shouldSuggest(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 1) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/pixiv\.net|fanbox\.cc|yande\.re|konachan\.|donmai\.us/i.test(t)) return false;
  return true;
}

export function suggestPrefix(source: Source, query: string): string {
  const t = query.trim();
  if (!t) return "";
  if (isBooru(source)) return t.split(/\s+/).pop() ?? "";
  return t;
}

export function applySuggest(source: Source, query: string, picked: string): string {
  if (!isBooru(source)) return picked;
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return picked;
  parts[parts.length - 1] = picked;
  return parts.join(" ");
}

function pushUnique(out: TagSuggestItem[], item: TagSuggestItem) {
  if (!item.tag || out.some((row) => row.tag === item.tag)) return;
  if (hasBlockedTags(splitTags(item.tag))) return;
  out.push(item);
}

export function parsePixivSuggest(json: unknown): TagSuggestItem[] {
  if (json == null) return [];
  const root = asRecord(json);
  const body = asRecord(root.body);
  const out: TagSuggestItem[] = [];
  const tags = Array.isArray(body.tags) ? body.tags : [];
  for (const raw of tags) {
    if (typeof raw === "string") {
      pushUnique(out, { tag: raw });
      continue;
    }
    const rec = asRecord(raw);
    const tag = asString(rec.tag || rec.tag_name || rec.name);
    const extra = asString(rec.tag_translation || rec.translation) || formatCount(asNumber(rec.access_count));
    pushUnique(out, { tag, extra: extra || undefined });
  }
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  for (const raw of candidates) {
    const rec = asRecord(raw);
    const tag = asString(rec.tag_name || rec.tag || rec.name);
    pushUnique(out, { tag, extra: formatCount(asNumber(rec.access_count)) });
  }
  return out.slice(0, MAX);
}

export function parseBooruSuggest(site: BooruSite, json: unknown): TagSuggestItem[] {
  if (!Array.isArray(json)) return [];
  const out: TagSuggestItem[] = [];
  for (const raw of json) {
    const rec = asRecord(raw);
    const tag = asString(rec.value || rec.name || rec.label);
    const extra = asString(rec.label) !== tag ? asString(rec.label) : formatCount(asNumber(rec.post_count || rec.count));
    pushUnique(out, { tag, extra: extra || undefined });
  }
  return out.slice(0, MAX);
}

export function mergeSuggest(local: string[], remote: TagSuggestItem[]): TagSuggestItem[] {
  return mergeSuggestLists(local, [], remote);
}

/** 已保存优先，最近次之，源站补全在后。同一词只出现一次。 */
export function mergeSuggestLists(
  saved: string[],
  recents: string[],
  remote: TagSuggestItem[],
): TagSuggestItem[] {
  const out: TagSuggestItem[] = [];
  for (const tag of saved) pushUnique(out, { tag, extra: "已保存" });
  for (const tag of recents) pushUnique(out, { tag, extra: "最近" });
  for (const item of remote) pushUnique(out, item);
  return out.slice(0, 10);
}

export function localMatches(source: Source, prefix: string, saved: readonly string[]): string[] {
  const needle = suggestPrefix(source, prefix).toLowerCase();
  if (!needle) return [];
  return saved.filter((tag) => shouldSuggest(tag) && tag.toLowerCase().includes(needle)).slice(0, 6);
}
