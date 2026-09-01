/**
 * 画师作品列表排序和置顶。
 *
 * 作用：profile/all 的 illusts 是数字 id 当 key，Object.keys 会从旧到新；Pixiv 页面是新到旧。
 * 用法：pixivIdsNewestFirst(body.illusts, body.manga)；pixivPickupItems(body.pickup)。
 * 为什么：整数 key 的对象会按数值升序枚举，看起来像「最旧在前」。
 */
export function pixivIdsNewestFirst(illusts: unknown, manga: unknown): string[] {
  const ids = [...objectKeys(illusts), ...objectKeys(manga)].filter((k) => /^\d+$/.test(k));
  return [...new Set(ids)].sort((a, b) => Number(b) - Number(a));
}

export function pixivPickupItems(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? rec.illustId ?? "");
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    const kind = String(rec.type ?? "");
    if (kind === "novel") continue;
    seen.add(id);
    out.push(rec);
  }
  return out;
}

function objectKeys(v: unknown): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.keys(v as Record<string, unknown>);
}
