/**
 * 图站标签英译中。
 *
 * 作用：Yande / Konachan / Danbooru 界面显示中文，搜索仍发英文 tag。
 * 用法：displayBooruTag("hatsune_miku")；设置里导出/导入 JSON。
 * 格式：[{ "en": "hatsune_miku", "zh": "初音未来" }]
 * 为什么：不靠自动机翻当唯一来源。内置是种子词表，用户译文覆盖同名 en。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { databaseTranslated } from "./tag-database.ts";

export type TagLexiconRow = { en: string; zh: string };

export const TAG_LEXICON_FORMAT = "kami-tag-lexicon-v1";

/** 常见图站标签种子，不是全表。用户导出后自己补译。 */
export const BUILTIN_TAG_LEXICON: TagLexiconRow[] = [
  { en: "1girl", zh: "单女" },
  { en: "1boy", zh: "单男" },
  { en: "2girls", zh: "双女" },
  { en: "3girls", zh: "三女" },
  { en: "multiple_girls", zh: "多名女性" },
  { en: "solo", zh: "单人" },
  { en: "highres", zh: "高分辨率" },
  { en: "absurdres", zh: "超高分辨率" },
  { en: "commentary_request", zh: "求解说" },
  { en: "translated", zh: "已翻译" },
  { en: "landscape", zh: "风景" },
  { en: "scenery", zh: "景色" },
  { en: "cityscape", zh: "城市风景" },
  { en: "night", zh: "夜晚" },
  { en: "sunset", zh: "日落" },
  { en: "sunrise", zh: "日出" },
  { en: "sky", zh: "天空" },
  { en: "cloud", zh: "云" },
  { en: "rain", zh: "雨" },
  { en: "snow", zh: "雪" },
  { en: "flower", zh: "花" },
  { en: "tree", zh: "树" },
  { en: "water", zh: "水" },
  { en: "ocean", zh: "海" },
  { en: "beach", zh: "海滩" },
  { en: "mountain", zh: "山" },
  { en: "forest", zh: "森林" },
  { en: "school_uniform", zh: "校服" },
  { en: "serafuku", zh: "水手服" },
  { en: "dress", zh: "连衣裙" },
  { en: "kimono", zh: "和服" },
  { en: "hoodie", zh: "连帽衫" },
  { en: "jacket", zh: "外套" },
  { en: "skirt", zh: "裙子" },
  { en: "pantyhose", zh: "连裤袜" },
  { en: "thighhighs", zh: "过膝袜" },
  { en: "boots", zh: "靴子" },
  { en: "hat", zh: "帽子" },
  { en: "glasses", zh: "眼镜" },
  { en: "long_hair", zh: "长发" },
  { en: "short_hair", zh: "短发" },
  { en: "twintails", zh: "双马尾" },
  { en: "ponytail", zh: "马尾" },
  { en: "braid", zh: "辫子" },
  { en: "blonde_hair", zh: "金发" },
  { en: "black_hair", zh: "黑发" },
  { en: "brown_hair", zh: "棕发" },
  { en: "white_hair", zh: "白发" },
  { en: "silver_hair", zh: "银发" },
  { en: "blue_hair", zh: "蓝发" },
  { en: "red_hair", zh: "红发" },
  { en: "pink_hair", zh: "粉发" },
  { en: "purple_hair", zh: "紫发" },
  { en: "green_hair", zh: "绿发" },
  { en: "blue_eyes", zh: "蓝眼" },
  { en: "red_eyes", zh: "红眼" },
  { en: "green_eyes", zh: "绿眼" },
  { en: "brown_eyes", zh: "棕眼" },
  { en: "yellow_eyes", zh: "黄眼" },
  { en: "purple_eyes", zh: "紫眼" },
  { en: "heterochromia", zh: "异色瞳" },
  { en: "smile", zh: "微笑" },
  { en: "blush", zh: "脸红" },
  { en: "looking_at_viewer", zh: "看向观众" },
  { en: "sitting", zh: "坐着" },
  { en: "standing", zh: "站着" },
  { en: "lying", zh: "躺着" },
  { en: "from_behind", zh: "背面" },
  { en: "from_side", zh: "侧面" },
  { en: "close-up", zh: "特写" },
  { en: "full_body", zh: "全身" },
  { en: "upper_body", zh: "上半身" },
  { en: "cowboy_shot", zh: "七分身" },
  { en: "portrait", zh: "肖像" },
  { en: "simple_background", zh: "简单背景" },
  { en: "white_background", zh: "白底" },
  { en: "outdoors", zh: "室外" },
  { en: "indoors", zh: "室内" },
  { en: "weapon", zh: "武器" },
  { en: "sword", zh: "刀剑" },
  { en: "gun", zh: "枪" },
  { en: "wings", zh: "翅膀" },
  { en: "animal_ears", zh: "兽耳" },
  { en: "cat_ears", zh: "猫耳" },
  { en: "fox_ears", zh: "狐耳" },
  { en: "tail", zh: "尾巴" },
  { en: "horns", zh: "角" },
  { en: "halo", zh: "光环" },
  { en: "touhou", zh: "东方" },
  { en: "original", zh: "原创" },
  { en: "vocaloid", zh: "VOCALOID" },
  { en: "hatsune_miku", zh: "初音未来" },
  { en: "kagamine_rin", zh: "镜音铃" },
  { en: "kagamine_len", zh: "镜音连" },
  { en: "megurine_luka", zh: "巡音流歌" },
  { en: "fate_(series)", zh: "Fate" },
  { en: "genshin_impact", zh: "原神" },
  { en: "honkai:_star_rail", zh: "崩坏：星穹铁道" },
  { en: "azur_lane", zh: "碧蓝航线" },
  { en: "arknights", zh: "明日方舟" },
  { en: "hololive", zh: "Hololive" },
  { en: "nintendo", zh: "任天堂" },
  { en: "pokemon", zh: "宝可梦" },
  { en: "rating:s", zh: "全年龄" },
  { en: "rating:q", zh: "敏感" },
  { en: "rating:e", zh: "成人向" },
  { en: "rating:g", zh: "大众级" },
];

export function normalizeLexiconKey(en: string): string {
  return en.trim().toLowerCase().replace(/\s+/g, "_");
}

export function parseTagLexicon(raw: unknown): TagLexiconRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { tags?: unknown }).tags)
      ? (raw as { tags: unknown[] }).tags
      : [];
  const out: TagLexiconRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const en = normalizeLexiconKey(typeof rec.en === "string" ? rec.en : "");
    const zh = typeof rec.zh === "string" ? rec.zh.trim() : "";
    if (!en || seen.has(en)) continue;
    seen.add(en);
    out.push({ en, zh });
  }
  return out;
}

export type ParsedBatch = { ok: TagLexiconRow[]; bad: number };

/**
 * 批量补录文本 → 词表行：每行取第一个出现的 Tab 或 `=`（谁先谁分），`=` 只切第一刀
 * （zh 里再出现 `=` 属于 zh）；Tab 形的 zh 段止于下一个 Tab（Excel 粘贴的备注列丢弃），
 * `=` 形不截。校验对齐 parseTagLexicon（en 归一非空、批内重复首者胜），唯空 zh 判非法——
 * parseTagLexicon 允许空 zh 行，但空 zh 在 lexiconMap 里是「删除该 en 译文」，补录语义下是误删。
 * 空行跳过不计数；不设行数上限（与导入 parseTagLexicon 同预算）。
 */
export function parseBatchRows(text: string): ParsedBatch {
  const ok: TagLexiconRow[] = [];
  let bad = 0;
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tabAt = line.indexOf("\t");
    const eqAt = line.indexOf("=");
    if (tabAt === -1 && eqAt === -1) {
      bad += 1;
      continue;
    }
    // 只有其一用其一；两者都有取先者。Tab 形 zh 截断，= 形不截
    const tabForm = tabAt !== -1 && (eqAt === -1 || tabAt < eqAt);
    const en = normalizeLexiconKey(tabForm ? line.slice(0, tabAt) : line.slice(0, eqAt));
    const rest = tabForm ? line.slice(tabAt + 1) : line.slice(eqAt + 1);
    const zhAt = rest.indexOf("\t");
    const zh = (tabForm && zhAt !== -1 ? rest.slice(0, zhAt) : rest).trim();
    if (!en || !zh) {
      bad += 1;
      continue;
    }
    if (seen.has(en)) continue;
    seen.add(en);
    ok.push({ en, zh });
  }
  return { ok, bad };
}

export function lexiconMap(userRows: readonly TagLexiconRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of databaseTranslated()) {
    if (row.zh) map.set(row.en, row.zh);
  }
  for (const row of BUILTIN_TAG_LEXICON) {
    if (row.zh) map.set(row.en, row.zh);
  }
  for (const row of userRows) {
    if (row.zh) map.set(row.en, row.zh);
    else map.delete(row.en);
  }
  return map;
}

export function translateBooruToken(token: string, map: Map<string, string>): string {
  const key = normalizeLexiconKey(token);
  return map.get(key) || token.replace(/_/g, " ");
}

/** tag 字符串 → 逐段归一键（与 displayTag 的 split 同口径）："Hatsune_Miku" → ["hatsune_miku"]、
 *  "landscape sky" → ["landscape", "sky"]；空段剔除。 */
export function lexiconTokens(tag: string): string[] {
  return tag.split(/\s+/).filter(Boolean).map(normalizeLexiconKey).filter(Boolean);
}

/** 是否词表可翻的 token：可打印 ASCII（booru token 形态）。CJK/全角 token 不归词表管——
 *  用户经批量标签手加的中文 tag 已可读，标「未翻」是噪音，且补录永远不可达。 */
export function isLexiconTargetToken(token: string): boolean {
  return /^[\x21-\x7E]+$/.test(token);
}

/** 该 tag 中未命中词表的 lexicon-target token 列表；空数组 = 无缺口（全命中或非词表域）。 */
export function untranslatedTokens(tag: string, map: Map<string, string>): string[] {
  return lexiconTokens(tag).filter((t) => isLexiconTargetToken(t) && !map.has(t));
}

export function upsertLexiconRow(rows: readonly TagLexiconRow[], en: string, zh: string): TagLexiconRow[] {
  const key = normalizeLexiconKey(en);
  if (!key) return [...rows];
  const next = rows.filter((row) => row.en !== key);
  const trimmed = zh.trim();
  if (trimmed) next.push({ en: key, zh: trimmed });
  return next.sort((a, b) => a.en.localeCompare(b.en));
}

export function mergeExportRows(known: readonly string[], userRows: readonly TagLexiconRow[]): TagLexiconRow[] {
  const user = new Map(userRows.map((r) => [r.en, r.zh]));
  const builtin = new Map(BUILTIN_TAG_LEXICON.map((r) => [r.en, r.zh]));
  const keys = new Set<string>();
  for (const tag of known) {
    const key = normalizeLexiconKey(tag);
    if (key) keys.add(key);
  }
  for (const row of userRows) keys.add(row.en);
  for (const row of databaseTranslated()) keys.add(row.en);
  for (const row of BUILTIN_TAG_LEXICON) keys.add(row.en);
  const db = new Map(databaseTranslated().map((r) => [r.en, r.zh]));
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((en) => ({ en, zh: user.get(en) || builtin.get(en) || db.get(en) || "" }));
}

type LexiconState = {
  rows: TagLexiconRow[];
  setRows: (rows: TagLexiconRow[]) => void;
  setZh: (en: string, zh: string) => void;
  addRows: (rows: TagLexiconRow[]) => void;
};

export const useTagLexicon = create<LexiconState>()(
  persist(
    (set) => ({
      rows: [],
      setRows: (rows) => set({ rows: parseTagLexicon(rows) }),
      setZh: (en, zh) => set((s) => ({ rows: upsertLexiconRow(s.rows, en, zh) })),
      // 批量补录：upsert 合并进现有表（不是 setRows 的导入整表换）；折叠自带去重 + 排序，
      // 同步段/备份读写整体 rows，自动搭车无需接线
      addRows: (rows) =>
        set((s) => ({ rows: rows.reduce((acc, r) => upsertLexiconRow(acc, r.en, r.zh), s.rows) })),
    }),
    { name: "kami-tag-lexicon", version: 1 },
  ),
);

export function currentLexiconMap(): Map<string, string> {
  return lexiconMap(useTagLexicon.getState().rows);
}
