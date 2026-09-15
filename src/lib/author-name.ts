/**
 * 画师名称规范化与别名（纯函数，零 import）。
 *
 * 作用：把带 @handle、emoji、装饰符（★♡♪・ 等）的画师显示名收成可归一的
 *      规范名；给统计 / 画像 / 导出分夹 / 镜像路径 / 筛选下拉提供同一套
 *      作者分组键（authorKey）与簇聚合（clusterAuthorVariants）。
 * 用法：normalizeAuthorName("画師A@pixiv") → "画師A"；authorKey(meta) 有
 *      authorId 用 `${source}:${authorId}`（有 id 绝不落名字，防两个画师
 *      装饰后同名被误合），缺 id 回退 `n:${规范名}`；别名表是「规范名 →
 *      用户定名」，调用方先 normalize 再 applyAuthorAlias（用户别名 >
 *      规范化函数 > 原名）。
 * 为什么零依赖：vault-export.server.ts 在服务端直接引用本文件，不能拖进
 *        store / 浏览器物；同时规则只此一份，各派生点自实现必然漂移，
 *        同一画师又裂成多份。输入用结构化的 AuthorLike（VaultMeta 结构
 *        兼容），连 type import 都不需要。
 */

/** @handle 尾巴：@ / 全角 ＠ 后跟 ASCII 字母数字._-（真实样本：画師A@pixiv、name＠twitter）。 */
const HANDLE_RE = /[@＠][A-Za-z0-9._-]+/g;

/**
 * emoji 单遍剥除族：表意与补充符号区（含 1F300-1FAFF 图画、1F1E6-1F1FF 国旗、
 * 1F100-1F1FF 包围字母数字「emoji 数字/符号区」、1F3FB-1F3FF 肤色）、杂项符号
 * + 丁贝符（2600-27BF，★☆♡♥ 都在这）、文本/emoji 变体选择符、ZWJ（👨‍🎨 组合）
 * 与键帽序列底座。CJK 不落在任何一段，天然不动。
 */
const EMOJI_RE = new RegExp(
  [
    "[\\u{1F000}-\\u{1FAFF}]",
    "[\\u{2600}-\\u{27BF}]",
    "[\\u{FE0E}\\u{FE0F}]",
    "\\u{200D}",
    "\\u{20E3}",
    "[#*0-9]\\u{FE0F}?\\u{20E3}",
  ].join("|"),
  "gu",
);

/** 首尾装饰符集合：只剥首尾，不动中间（中间的 ・〜— 是名字的一部分时保留）。 */
const DECORATION_CHARS = "★☆♡♥♪●◆◇※・✦✧▼▽▲△†‡º°〜～—–-－·•‧";
const DECORATION_CLASS = DECORATION_CHARS.replace(/[-\\\]]/g, "\\$&");
/** 首尾的「装饰符 + 空白」一起剥（剥完装饰露出空白也算边）。 */
const EDGE_RE = new RegExp(`^[${DECORATION_CLASS}\\s]+|[${DECORATION_CLASS}\\s]+$`, "gu");

/**
 * 规范化画师显示名。顺序有测试锁：@handle → emoji → 折叠内部空白 → 剥首尾
 * 装饰/空白。保守边界：不动 CJK、不删括号内容、不大小写折叠；剥到空回退原串
 * （全是装饰的名字整串保留，宁可多建一个夹也不丢人）。
 */
export function normalizeAuthorName(raw: string): string {
  if (typeof raw !== "string" || raw === "") return "";
  const stripped = raw
    .replace(HANDLE_RE, "")
    .replace(EMOJI_RE, "")
    .replace(/[\s\u200B]+/g, " ")
    .replace(EDGE_RE, "")
    .replace(EDGE_RE, "");
  return stripped || raw;
}

/** 用户别名优先：规范名命中别名表就换用户定名，否则原样返回。 */
export function applyAuthorAlias(name: string, aliases?: Record<string, string>): string {
  if (!aliases || !name) return name;
  const mapped = aliases[name];
  return typeof mapped === "string" && mapped.trim() && mapped !== name ? mapped : name;
}

export const AUTHOR_ALIAS_ENTRY_LIMIT = 200;
export const AUTHOR_ALIAS_TEXT_LIMIT = 120;

/**
 * 别名表入口裁剪（备份 / 同步段 / 导出 API 共用）：≤200 条、键值 trim 后各
 * ≤120 字符、值必须 ≠ 键；坏项按序丢弃不连坐，超限截断防同步段膨胀。
 */
export function parseAuthorAliases(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const key = typeof rawKey === "string" ? rawKey.trim().slice(0, AUTHOR_ALIAS_TEXT_LIMIT) : "";
    const val = typeof rawVal === "string" ? rawVal.trim().slice(0, AUTHOR_ALIAS_TEXT_LIMIT) : "";
    if (!key || !val || key === val) continue;
    if (Object.keys(out).length >= AUTHOR_ALIAS_ENTRY_LIMIT) break;
    out[key] = val;
  }
  return out;
}

/** authorKey 的最小输入形状；VaultMeta 结构兼容，测试也能用裸对象。 */
export type AuthorLike = {
  author: string;
  authorId?: string;
  source?: string;
};

/**
 * 作者分组键：有 authorId 用 `${source}:${authorId}`（有 id 绝不落名字）；
 * 缺 id 回退 `n:${规范名}`（无 id 的装饰变体靠规范化归一）。
 */
export function authorKey(item: AuthorLike): string {
  const id = typeof item.authorId === "string" ? item.authorId.trim() : "";
  if (id) return `${item.source ?? ""}:${id}`;
  return `n:${normalizeAuthorName(item.author)}`;
}

/** 簇成员的最小输入形状（VaultMeta 兼容）。 */
export type AuthorItem = AuthorLike & { savedAt?: number };

export type AuthorVariant = { name: string; count: number };

export type AuthorCluster = {
  /** authorKey：同 id 双名称归一；无 id 装饰变体经规范化归一。 */
  key: string;
  /** 展示名 = 簇内最新（savedAt 最大）出现的 raw 名经规范化；别名由调用方再套。 */
  displayName: string;
  /** 簇内出现过的 raw 名与各自计数（计数降序、同频按字典序）。 */
  variants: AuthorVariant[];
  totalCount: number;
};

/**
 * 把纸匣条目聚成「待整理簇」：同 authorId 的多个写法、无 id 但规范化后同名
 * 的变体各成一簇。无名作者不参与。簇按总数降序（同数按 key 字典序）——
 * 整理 UI 先给最值得归一的看。
 */
export function clusterAuthorVariants(items: readonly AuthorItem[]): AuthorCluster[] {
  type Acc = { count: number; names: Map<string, number>; latestName: string; latestAt: number };
  const order: string[] = [];
  const acc = new Map<string, Acc>();
  for (const item of items) {
    const raw = typeof item.author === "string" ? item.author.trim() : "";
    if (!raw) continue;
    const key = authorKey(item);
    let cur = acc.get(key);
    if (!cur) {
      cur = { count: 0, names: new Map(), latestName: raw, latestAt: item.savedAt ?? 0 };
      acc.set(key, cur);
      order.push(key);
    }
    cur.count += 1;
    cur.names.set(raw, (cur.names.get(raw) ?? 0) + 1);
    const at = item.savedAt ?? 0;
    if (at >= cur.latestAt) {
      // >=：同一时刻取后出现的（列表按 savedAt 新→旧排时，即最靠前那条）
      cur.latestName = raw;
      cur.latestAt = at;
    }
  }
  return order
    .map((key) => {
      const cur = acc.get(key)!;
      return {
        key,
        displayName: normalizeAuthorName(cur.latestName),
        variants: [...cur.names.entries()]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([name, count]) => ({ name, count })),
        totalCount: cur.count,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount || (a.key < b.key ? -1 : 1));
}

/** 簇是否还需要整理：各变体经「规范化 + 别名」后仍指向不止一个名字。 */
export function clusterNeedsAlias(cluster: AuthorCluster, aliases?: Record<string, string>): boolean {
  const resolved = new Set(cluster.variants.map((v) => applyAuthorAlias(normalizeAuthorName(v.name), aliases)));
  return resolved.size > 1;
}
