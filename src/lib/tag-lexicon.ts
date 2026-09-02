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

export function lexiconMap(userRows: readonly TagLexiconRow[]): Map<string, string> {
  const map = new Map<string, string>();
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

export function mergeExportRows(known: readonly string[], userRows: readonly TagLexiconRow[]): TagLexiconRow[] {
  const user = new Map(userRows.map((r) => [r.en, r.zh]));
  const builtin = new Map(BUILTIN_TAG_LEXICON.map((r) => [r.en, r.zh]));
  const keys = new Set<string>();
  for (const tag of known) {
    const key = normalizeLexiconKey(tag);
    if (key) keys.add(key);
  }
  for (const row of userRows) keys.add(row.en);
  for (const row of BUILTIN_TAG_LEXICON) keys.add(row.en);
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((en) => ({ en, zh: user.get(en) || builtin.get(en) || "" }));
}

type LexiconState = {
  rows: TagLexiconRow[];
  setRows: (rows: TagLexiconRow[]) => void;
};

export const useTagLexicon = create<LexiconState>()(
  persist(
    (set) => ({
      rows: [],
      setRows: (rows) => set({ rows: parseTagLexicon(rows) }),
    }),
    { name: "kami-tag-lexicon", version: 1 },
  ),
);

export function currentLexiconMap(): Map<string, string> {
  return lexiconMap(useTagLexicon.getState().rows);
}
