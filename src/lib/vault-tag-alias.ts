/**
 * 标签别名归一层（纯函数，零 import）。
 *
 * 作用：同一事物在纸匣里裂成多个标签变体（鳴潮 / 鸣潮 / WutheringWaves /
 *      ｗｕｔｈｅｒｉｎｇｗａｖｅｓ…）时，把机械变体（大小写 / 全半角 / 空白）聚成
 *      待整理簇（clusterTagVariants），再由用户拍板的别名表
 *      tagAliases（变体原文 → 规范名）在消费点统一展示与计数。落盘的
 *      item.tags 原文一个字节都不动，删别名即完全还原。
 * 用法：normalizeTagKey("ＷｕｔｈｅｒｉｎｇＷａｖｅｓ") → "wutheringwaves"（聚类
 *      键，只兜机械变体，繁简 / 跨语言不合）；applyTagAlias("鳴潮", aliases)
 *      单跳查表，命中换规范名；applyTagAliases(tags, aliases) 再加 trim、
 *      去空、去重（保首次出现序）给卡片 / 统计用；parseTagAliases 是备份 /
 *      同步段入口的裁剪口径；clusterTagVariants + clusterNeedsAlias 供设置
 *      页整理卡列出待归一簇；tagsAfterAdd / tagsAfterRemove 是纸匣批量加删
 *      标签的匹配语义（归一后相等才动原文，见函数组注释）。
 * 为什么零依赖且与 author-name 分表：与画师别名（规范名 → 用户定名）不同，
 *        标签没有可依赖的规范化函数（任意字符串），表方向是「变体原文 →
 *        规范名」且单跳映射——A→B 与 B→C 并存时 A 落到 B 而非 C，防链靠
 *        三层：applyTagAlias 单跳、setTagAliasCluster 删以规范名为键的旧
 *        条目、parseTagAliases 丢成链条目。tag-lexicon 的 en→zh 是浏览
 *        显示域，与纸匣归一域分离，不共用表。
 */

export const TAG_ALIAS_ENTRY_LIMIT = 500;
export const TAG_ALIAS_TEXT_LIMIT = 120;

/**
 * 聚类键：NFKC（全半角 / 连字 / 组合字符折成标准形）+ 小写 + 折叠空白 +
 * trim。只兜机械变体——鳴潮 与 鸣潮 是不同字符，NFKC 不合（跨语言归并靠
 * 人拍板，非目标）。非字符串 / 剥空输入返回 ""。
 */
export function normalizeTagKey(raw: string): string {
  if (typeof raw !== "string" || raw === "") return "";
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** 单跳查表：命中别名表换规范名，否则原样返回。绝不链式二跳（防 A→B→C 漂移）。 */
export function applyTagAlias(tag: string, aliases?: Record<string, string>): string {
  if (!aliases || !tag) return tag;
  const mapped = aliases[tag];
  return typeof mapped === "string" && mapped.trim() !== "" && mapped !== tag ? mapped : tag;
}

/**
 * 列表版：trim → 去空 → 单跳映射 → 去重（保首次出现序）。同一张图同时带
 * 「鳴潮 / 鸣潮」两变体时，输出只剩一个规范名（展示层去重、统计层合并的
 * 公共底座）。
 */
export function applyTagAliases(tags: readonly string[], aliases?: Record<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag) continue;
    const resolved = applyTagAlias(tag, aliases);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * 别名表入口裁剪（备份 / 同步段 / store migration 共用）：≤500 条、键值
 * trim 后各 ≤120 字符、值必须 ≠ 键；值同时是另一键的成链条目按序丢弃
 * （防环防链，见文件头）；坏项按序丢弃不连坐，超限按序截断防同步段膨胀。
 */
export function parseTagAliases(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  // 成链判定用与键同一套裁剪（trim + ≤120）后的键集：保证输出表自身无链
  // （{a:"b"," b ":"c"} 这种键带边空白的隐性链也要丢），且与丢弃顺序无关
  const keySet = new Set(Object.keys(input).map((k) => k.trim().slice(0, TAG_ALIAS_TEXT_LIMIT)));
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(input)) {
    const key = rawKey.trim().slice(0, TAG_ALIAS_TEXT_LIMIT);
    const val = typeof rawVal === "string" ? rawVal.trim().slice(0, TAG_ALIAS_TEXT_LIMIT) : "";
    if (!key || !val || key === val) continue;
    if (keySet.has(val)) continue; // 值同时是另一键 → 成链，丢弃
    if (Object.keys(out).length >= TAG_ALIAS_ENTRY_LIMIT) break;
    out[key] = val;
  }
  return out;
}

/** 聚类输入的最小形状（VaultMeta 结构兼容，测试用裸对象也行）。 */
export type TagItemLike = { tags?: readonly unknown[] | null };

export type TagVariant = { name: string; count: number };

export type TagCluster = {
  /** normalizeTagKey：大小写 / 全半角 / 空白这类机械变体的归一键。 */
  key: string;
  /** 簇内出现过的标签原文与各自计数（计数降序、同频按字典序）——供挑规范写法。 */
  variants: TagVariant[];
  /** 簇内标签出现次数合计（同一作品带重复变体只计一次）。 */
  totalCount: number;
};

/**
 * 把纸匣条目聚成「待整理簇」：按 normalizeTagKey 归一，同键多个原文变体
 * 才成簇（≥2 变体）；单变体键不成簇。簇按合计降序（同数按 key 字典序），
 * 整理卡先给最值得归一的看。
 */
export function clusterTagVariants(items: readonly TagItemLike[]): TagCluster[] {
  const acc = new Map<string, Map<string, number>>();
  for (const item of items) {
    const seenInItem = new Set<string>();
    const list = Array.isArray(item.tags) ? item.tags : [];
    for (const raw of list) {
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (!name || seenInItem.has(name)) continue; // 同作品重复变体只计一次
      seenInItem.add(name);
      const key = normalizeTagKey(name);
      let names = acc.get(key);
      if (!names) {
        names = new Map();
        acc.set(key, names);
      }
      names.set(name, (names.get(name) ?? 0) + 1);
    }
  }
  return [...acc.entries()]
    .map(([key, names]) => {
      const variants = [...names.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([name, count]) => ({ name, count }));
      const totalCount = variants.reduce((sum, v) => sum + v.count, 0);
      return { key, variants, totalCount };
    })
    .filter((c) => c.variants.length >= 2)
    .sort((a, b) => b.totalCount - a.totalCount || (a.key < b.key ? -1 : 1));
}

/** 簇是否还需要整理：各变体经别名表后仍指向不止一个展示名。 */
export function clusterNeedsAlias(cluster: TagCluster, aliases?: Record<string, string>): boolean {
  const resolved = new Set(cluster.variants.map((v) => applyTagAlias(v.name, aliases)));
  return resolved.size > 1;
}

/**
 * 批量加/删标签的匹配语义（M2，唯一的显式改写落盘原文的操作）。
 *
 * 目标名与条目原文都过单跳别名（applyTagAlias）后比较：删「鳴潮」同删该作品上
 * 「鸣潮」等变体原文（按展示名匹配）；加「鸣潮」（变体）写入的是规范名「鳴潮」
 * 原文——不展开成变体。返回 null 表示这张无需改写（删无命中 / 加已有效），
 * 调用方跳过写回，影响张数即返回非 null 的条数。
 */

/** 加标签后的 tags：目标过别名归一成规范名，追加在尾部；已有同展示名（含变体）返回 null。 */
export function tagsAfterAdd(
  tags: readonly string[],
  target: string,
  aliases?: Record<string, string>,
): string[] | null {
  const resolved = applyTagAlias(target.trim(), aliases);
  if (!resolved) return null;
  if (tags.some((t) => applyTagAlias(t.trim(), aliases) === resolved)) return null;
  return [...tags, resolved];
}

/** 删标签后的 tags：所有归一后与目标相等的原文一起移除（变体同删），保序；无命中返回 null。 */
export function tagsAfterRemove(
  tags: readonly string[],
  target: string,
  aliases?: Record<string, string>,
): string[] | null {
  const resolved = applyTagAlias(target.trim(), aliases);
  if (!resolved) return null;
  const kept = tags.filter((t) => applyTagAlias(t.trim(), aliases) !== resolved);
  return kept.length === tags.length ? null : kept;
}
