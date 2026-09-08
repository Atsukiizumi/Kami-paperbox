/**
 * 图站标签数据库（打包进应用的那一层）。
 *
 * 作用：给 Yande / Konachan / Danbooru 一套可版本化的 en→zh 词库，按命名空间收。
 * 用法：databaseMap() 给 lexicon；databaseRows() 给设置页仓库。
 * 为什么：EhTag 那份库是 E 站命名空间，不能拿来翻图站。
 */
import packed from "../data/booru-database.json" with { type: "json" };

export const TAG_DATABASE_FORMAT = "kami-booru-database-v1";

export const TAG_NAMESPACES = ["general", "copyright", "character", "artist", "circle", "meta"] as const;
export type TagNamespace = (typeof TAG_NAMESPACES)[number];

export type TagDatabaseRow = {
  en: string;
  zh: string;
  ns: TagNamespace;
  count: number;
};

function asNs(v: string): TagNamespace {
  return (TAG_NAMESPACES as readonly string[]).includes(v) ? (v as TagNamespace) : "general";
}

export const TAG_DATABASE: TagDatabaseRow[] = Array.isArray((packed as { tags?: unknown }).tags)
  ? (packed as { tags: Array<{ en?: string; zh?: string; ns?: string; count?: number }> }).tags
      .map((row) => ({
        en: String(row.en ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_"),
        zh: typeof row.zh === "string" ? row.zh.trim() : "",
        ns: asNs(String(row.ns ?? "general")),
        count: Number(row.count) || 0,
      }))
      .filter((row) => row.en)
  : [];

export function databaseRows(): TagDatabaseRow[] {
  return TAG_DATABASE;
}

export function databaseMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of TAG_DATABASE) {
    if (row.zh) map.set(row.en, row.zh);
  }
  return map;
}

export function databaseTranslated(): Array<{ en: string; zh: string }> {
  return TAG_DATABASE.filter((row) => row.zh).map((row) => ({ en: row.en, zh: row.zh }));
}
