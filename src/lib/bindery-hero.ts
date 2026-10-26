/**
 * BINDERY 落地页首屏「铺纸」的版式架纯函数层。
 *
 * 作用：多档版式（presets + activeId）的加载/切换/存档/删除/迁移，排格枚举与
 *      拖拽·键盘搬移的顺序运算，印章头中文数字日期。规则与案头 deskPresets
 *      同一套语义：内置档护删、用户档即时写、删活跃档回落默认。
 * 用法：src/routes/bindery.tsx 以 useState 驱动；localStorage 键 kamiBinderyHeroV2，
 *      静态提案稿的旧单档 kamiBinderyHero 自动迁移为「旧档」并清键。
 * 为什么：档位操作与顺序运算必须可单测（回落/护删/去重补全），组件里不留业务规则；
 *      与 src/lib/desk-layout.ts 一样走纯函数层，测试用 node:test 直跑 strip-types。
 */

export const BINDERY_STORAGE_KEY = "kamiBinderyHeroV2";
export const BINDERY_LEGACY_KEY = "kamiBinderyHero";
export const BINDERY_DEFAULT_PRESET_ID = "builtin-default";

/** 排格三档：格是档内参数（版式档 = 格 + 顺序 + 纸条开关）。 */
export const BINDERY_GRIDS = [
  ["quad", "四联"],
  ["duo", "二二"],
  ["feature", "主幅"],
] as const;

export type BinderyGrid = "quad" | "duo" | "feature";
export type BinderySlips = { letters: boolean; stack: boolean; wall: boolean };
export type BinderyHeroData = { grid: BinderyGrid; order: string[]; slips: BinderySlips };
export type BinderyPreset = { id: string; name: string; builtin: boolean; data: BinderyHeroData };
export type BinderyPresetDoc = { presets: BinderyPreset[]; activeId: string };

/** 首屏四枚図版的稳定 id（静态稿 t1–t4 平移而来）。 */
export const BINDERY_TILE_IDS: readonly string[] = ["t1", "t2", "t3", "t4"];

export const BINDERY_DEFAULT_DATA: BinderyHeroData = {
  grid: "quad",
  order: ["t1", "t2", "t3", "t4"],
  slips: { letters: true, stack: true, wall: true },
};

export function cloneBinderyData(d: BinderyHeroData): BinderyHeroData {
  return { grid: d.grid, order: d.order.slice(), slips: { ...d.slips } };
}

export function defaultBinderyDoc(): BinderyPresetDoc {
  return {
    presets: [
      { id: BINDERY_DEFAULT_PRESET_ID, name: "默认", builtin: true, data: cloneBinderyData(BINDERY_DEFAULT_DATA) },
    ],
    activeId: BINDERY_DEFAULT_PRESET_ID,
  };
}

export function clampBinderyGrid(g: string): BinderyGrid {
  return BINDERY_GRIDS.some(([id]) => id === g) ? (g as BinderyGrid) : "quad";
}

export function gridLabel(g: BinderyGrid): string {
  return BINDERY_GRIDS.find(([id]) => id === g)?.[1] ?? "四联";
}

/** 四联一行四列；其余排格两列——键盘上下搬移的列宽依据。 */
export function gridColumns(g: BinderyGrid): number {
  return g === "quad" ? 4 : 2;
}

/** 任意来源的数据收敛成合法档数据：排格钳制、顺序去重并补全缺失図版、纸条开关兜底。 */
export function normalizeBinderyData(raw: unknown): BinderyHeroData {
  const src = (raw ?? {}) as Partial<BinderyHeroData> & { slips?: Partial<BinderySlips> };
  const rawOrder = Array.isArray(src.order) ? src.order.filter((id): id is string => typeof id === "string") : [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of rawOrder) {
    if (BINDERY_TILE_IDS.includes(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of BINDERY_TILE_IDS) {
    if (!seen.has(id)) order.push(id);
  }
  const slipsRaw: Partial<BinderySlips> = src.slips ?? {};
  return {
    grid: clampBinderyGrid(typeof src.grid === "string" ? src.grid : "quad"),
    order,
    slips: {
      letters: slipsRaw.letters !== false,
      stack: slipsRaw.stack !== false,
      wall: slipsRaw.wall !== false,
    },
  };
}

export function activeBinderyPreset(doc: BinderyPresetDoc): BinderyPreset {
  return doc.presets.find((p) => p.id === doc.activeId) ?? doc.presets[0];
}

/** 切档：目标不存在时原样返回（防御坏存档）。 */
export function switchBinderyPreset(doc: BinderyPresetDoc, id: string): BinderyPresetDoc {
  if (!doc.presets.some((p) => p.id === id)) return doc;
  return { ...doc, activeId: id };
}

let presetSeq = 0;

/** 存为新档：追加并激活；同名不冲突（id 唯一）。 */
export function addBinderyPreset(doc: BinderyPresetDoc, name: string, data: BinderyHeroData): { doc: BinderyPresetDoc; id: string } {
  const trimmed = name.trim() || `版式·${doc.presets.length}`;
  const id = `u${Date.now().toString(36)}${(presetSeq++).toString(36)}`;
  return {
    doc: { presets: [...doc.presets, { id, name: trimmed, builtin: false, data: cloneBinderyData(data) }], activeId: id },
    id,
  };
}

/** 删档：内置档与未知档拒删；删的是活跃档则回落默认（默认档永远在首位、不可删）。 */
export function removeBinderyPreset(doc: BinderyPresetDoc, id: string): BinderyPresetDoc {
  const target = doc.presets.find((p) => p.id === id);
  if (!target || target.builtin) return doc;
  const presets = doc.presets.filter((p) => p.id !== id);
  const activeId = doc.activeId === id ? BINDERY_DEFAULT_PRESET_ID : doc.activeId;
  return { presets, activeId };
}

/** 拖拽语义：把 from 移到 to 的前面（摆位，不是交换）。 */
export function moveTileBefore(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId || !order.includes(fromId) || !order.includes(toId)) return order;
  const next = order.filter((id) => id !== fromId);
  next.splice(next.indexOf(toId), 0, fromId);
  return next;
}

/** 键盘搬移语义：按下标交换；越界原样返回。 */
export function swapByIndex(order: string[], i: number, j: number): string[] {
  if (i < 0 || j < 0 || i >= order.length || j >= order.length || i === j) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** 印章头中文数字日（1–31 → 一…卅一；案头「今日的纸」同款写法）。 */
export function cnDayChar(day: number): string {
  const ones = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (!Number.isInteger(day) || day < 1 || day > 31) return "";
  if (day <= 10) return day === 10 ? "十" : ones[day];
  if (day < 20) return `十${ones[day - 10]}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${ones[day - 20]}`;
  return day === 30 ? "三十" : "卅一";
}

/** 解析存档 JSON：结构不对/空返回 null（调用方回落默认档）。 */
export function parseBinderyDoc(json: string | null): BinderyPresetDoc | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { presets?: unknown[]; activeId?: unknown };
    if (!Array.isArray(raw.presets) || raw.presets.length === 0) return null;
    const presets: BinderyPreset[] = [];
    for (const item of raw.presets) {
      const p = item as Partial<BinderyPreset> | null;
      if (!p || typeof p.id !== "string" || typeof p.name !== "string") continue;
      presets.push({ id: p.id, name: p.name, builtin: p.builtin === true, data: normalizeBinderyData(p.data) });
    }
    if (presets.length === 0) return null;
    if (!presets.some((p) => p.builtin)) {
      presets.unshift({ id: BINDERY_DEFAULT_PRESET_ID, name: "默认", builtin: true, data: cloneBinderyData(BINDERY_DEFAULT_DATA) });
    }
    const activeId = typeof raw.activeId === "string" && presets.some((p) => p.id === raw.activeId) ? raw.activeId : BINDERY_DEFAULT_PRESET_ID;
    return { presets, activeId };
  } catch {
    return null;
  }
}

type BinderyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function legacyToDoc(json: string): BinderyPresetDoc | null {
  // 静态提案稿的单档记录：{ layout, order, slips:{letters:1,…} }（开关是 0/1）。
  try {
    const raw = JSON.parse(json) as { layout?: unknown; order?: unknown; slips?: Record<string, unknown> };
    if (!Array.isArray(raw.order)) return null;
    const slips = raw.slips ?? {};
    const data = normalizeBinderyData({
      grid: typeof raw.layout === "string" ? raw.layout : "quad",
      order: raw.order,
      slips: {
        letters: slips.letters !== 0 && slips.letters !== false,
        stack: slips.stack !== 0 && slips.stack !== false,
        wall: slips.wall !== 0 && slips.wall !== false,
      },
    });
    const doc = defaultBinderyDoc();
    doc.presets.push({ id: "u-legacy", name: "旧档", builtin: false, data });
    return { presets: doc.presets, activeId: "u-legacy" };
  } catch {
    return null;
  }
}

/** 读档（客户端调用）：新键优先；无新键有旧键则迁移成「旧档」并落回新键、清掉旧键。 */
export function loadBinderyDoc(storage: BinderyStorage = typeof window === "undefined" ? undefined! : window.localStorage): BinderyPresetDoc {
  const direct = parseBinderyDoc(storage.getItem(BINDERY_STORAGE_KEY));
  if (direct) return direct;
  const legacy = legacyToDoc(storage.getItem(BINDERY_LEGACY_KEY) ?? "");
  if (legacy) {
    storage.setItem(BINDERY_STORAGE_KEY, JSON.stringify(legacy));
    storage.removeItem(BINDERY_LEGACY_KEY);
    return legacy;
  }
  return defaultBinderyDoc();
}

export function saveBinderyDoc(doc: BinderyPresetDoc, storage: BinderyStorage = typeof window === "undefined" ? undefined! : window.localStorage): void {
  try {
    storage.setItem(BINDERY_STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // 隐私模式/配额：档位是锦上添花，写不进去不报错。
  }
}
