/**
 * 案头布局编排的纯数据层（布局引擎 P1）。
 *
 * 作用：定义「槽模型」编排数据（DeskLayout/DeskPreset）、外壳形态与旋钮
 *      （ShellForm/ShellTweaks）、各页版式参数（PageLayout），并提供从
 *      持久层/主题包回读时的白名单清洗（parseDeskLayout 等）——未知模块
 *      丢弃、span 钳位、空槽剪枝、内置版式保护。
 * 用法：store v18 持久化与 migrate 调 parse* 清洗；desk.tsx / desk-edit.tsx
 *      读类型摆模块；app-shell / theme-provider 读 shell 决定外壳形态。
 * 为什么：清洗必须是零依赖纯函数，node --test 里表驱动断言边界；编辑器、
 *      迁移、主题包（P2）三方共用同一套口径，不各写一套。
 */

/** 可摆放进槽的案头模块。onthisday（去年今日笺）固定页眉位，不进槽。 */
export type DeskModuleId = "browse-sheet" | "newspaper" | "letters" | "stack" | "artist-wall";

/** 页眉位特例模块：不走槽，只跟随 headerSlip 开关。 */
export type DeskHeaderModuleId = "onthisday";

export type DeskSlot = { span: 1 | 2 | 3; items: DeskModuleId[] };

export type DeskLayout = {
  slots: DeskSlot[];
  /** 去年今日笺（页眉）是否上场；默认 true。 */
  headerSlip: boolean;
};

export type DeskPreset = { id: string; name: string; layout: DeskLayout; builtIn?: boolean };

export type ShellForm = "desk" | "rail" | "zen";

/**
 * 外壳旋钮（按形态白名单生效，越权键直接丢弃）：
 * desk → contentWidth / topbarDensity；rail → contentWidth / iconSize / topbar；
 * zen → contentMargin / triggerSide。contentWidth 同时驱动各页页宽。
 */
export type ShellTweaks = Partial<{
  contentWidth: "paper" | "wide" | "full";
  topbarDensity: "normal" | "compact";
  iconSize: "sm" | "md" | "lg";
  topbar: "on" | "float";
  contentMargin: "normal" | "tight";
  triggerSide: "left" | "right";
}>;

export type ShellSettings = { form: ShellForm; tweaks: ShellTweaks };

/** 各页版式参数：浏览密度 / 纸匣列宽。medium = 现状数值。 */
export type PageLayout = { density: "loose" | "medium" | "tight"; vaultCol: "narrow" | "medium" | "wide" };

export const DESK_MODULE_IDS: readonly DeskModuleId[] = [
  "browse-sheet",
  "newspaper",
  "letters",
  "stack",
  "artist-wall",
];

/** 编辑 UI 的模块中文名（槽模型五件套 + 页眉笺）。 */
export const DESK_MODULE_LABELS: Record<DeskModuleId | DeskHeaderModuleId, string> = {
  "browse-sheet": "铺纸",
  newspaper: "今日报纸",
  letters: "信",
  stack: "纸叠",
  "artist-wall": "画师墙",
  onthisday: "去年今日笺（页眉）",
};

/** 内置版式「稿纸」：逐项复刻 2026-10 合并版案头（铺纸2 + 右栏三件套 + 报纸通栏）。 */
export const DESK_DEFAULT_PRESET_ID = "kami-default";

export const DEFAULT_DESK_LAYOUT: DeskLayout = {
  slots: [
    { span: 2, items: ["browse-sheet"] },
    { span: 1, items: ["letters", "stack", "artist-wall"] },
    { span: 3, items: ["newspaper"] },
  ],
  headerSlip: true,
};

export const DEFAULT_SHELL: ShellSettings = { form: "desk", tweaks: {} };

export const DEFAULT_PAGE_LAYOUT: PageLayout = { density: "medium", vaultCol: "medium" };

/** 用户版式上限（含内置不占额）。 */
export const DESK_PRESET_LIMIT = 12;

function isDeskModuleId(v: unknown): v is DeskModuleId {
  return typeof v === "string" && (DESK_MODULE_IDS as readonly string[]).includes(v);
}

/** 槽数组里是否存在至少一个「带合法模块的有效槽」（主题包 layout 段的降级判据）。 */
export function hasValidDeskSlot(slotsRaw: unknown): boolean {
  if (!Array.isArray(slotsRaw)) return false;
  return slotsRaw.some((s) => {
    if (!s || typeof s !== "object") return false;
    const items = (s as Record<string, unknown>).items;
    return Array.isArray(items) && items.some((id) => isDeskModuleId(id));
  });
}

/**
 * 布局清洗：槽/span/模块白名单全过一遍——未知模块丢、span 钳 1-3、空槽剪枝、
 * 重复上场去重（同一模块只保留首个位置）、五件套全下场时回默认（案头不能空）。
 */
export function parseDeskLayout(raw: unknown): DeskLayout {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const rawSlots = Array.isArray(rec.slots) ? rec.slots : [];
  const seen = new Set<DeskModuleId>();
  const slots: DeskSlot[] = [];
  for (const s of rawSlots) {
    const slot = (s ?? {}) as Record<string, unknown>;
    const spanRaw = Number(slot.span);
    const span: DeskSlot["span"] = spanRaw === 2 ? 2 : spanRaw === 3 ? 3 : 1;
    const items = Array.isArray(slot.items)
      ? slot.items.filter((id): id is DeskModuleId => isDeskModuleId(id) && !seen.has(id) && (seen.add(id), true))
      : [];
    if (items.length > 0) slots.push({ span, items });
  }
  const headerSlip = rec.headerSlip !== false;
  if (slots.length === 0) return { ...DEFAULT_DESK_LAYOUT, headerSlip };
  return { slots, headerSlip };
}

/** 版式清单清洗：去重 id、上限截断、内置稿纸永远在场且不可被用户条目顶替。 */
export function parseDeskPresets(raw: unknown): { presets: DeskPreset[]; activePresetId: string } {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const rawList = Array.isArray(rec.presets) ? rec.presets : [];
  const out: DeskPreset[] = [{ id: DESK_DEFAULT_PRESET_ID, name: "稿纸", layout: DEFAULT_DESK_LAYOUT, builtIn: true }];
  const ids = new Set([DESK_DEFAULT_PRESET_ID]);
  for (const p of rawList) {
    const item = (p ?? {}) as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 64) : "";
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 24) : "";
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    out.push({ id, name, layout: parseDeskLayout(item.layout) });
    if (out.length >= DESK_PRESET_LIMIT + 1) break;
  }
  const active = typeof rec.activePresetId === "string" && ids.has(rec.activePresetId) ? rec.activePresetId : DESK_DEFAULT_PRESET_ID;
  return { presets: out, activePresetId: active };
}

const SHELL_FORMS: readonly ShellForm[] = ["desk", "rail", "zen"];

/** 各形态开放的旋钮白名单——C 模式的核心：越权键在清洗阶段就消失。 */
export const SHELL_TWEAK_KEYS: Record<ShellForm, readonly (keyof ShellTweaks)[]> = {
  desk: ["contentWidth", "topbarDensity"],
  rail: ["contentWidth", "iconSize", "topbar"],
  zen: ["contentMargin", "triggerSide"],
};

const TWEAK_VALUES: Record<keyof ShellTweaks, readonly string[]> = {
  contentWidth: ["paper", "wide", "full"],
  topbarDensity: ["normal", "compact"],
  iconSize: ["sm", "md", "lg"],
  topbar: ["on", "float"],
  contentMargin: ["normal", "tight"],
  triggerSide: ["left", "right"],
};

/** 外壳清洗：形态枚举 + 旋钮白名单（形态外/取值外的键值全丢）；形态本身非法则整段回默认。 */
export function parseShell(raw: unknown): ShellSettings {
  const rec = (raw ?? {}) as Record<string, unknown>;
  if (!SHELL_FORMS.includes(rec.form as ShellForm)) return { form: "desk", tweaks: {} };
  const form = rec.form as ShellForm;
  const tweaksRaw = (rec.tweaks ?? {}) as Record<string, unknown>;
  const tweaks: ShellTweaks = {};
  for (const key of SHELL_TWEAK_KEYS[form]) {
    const v = tweaksRaw[key];
    if (typeof v === "string" && TWEAK_VALUES[key].includes(v)) {
      (tweaks as Record<string, string>)[key] = v;
    }
  }
  return { form, tweaks };
}

/** 各页参数清洗：越界值回 medium（= 现状）。 */
export function parsePageLayout(raw: unknown): PageLayout {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const density = rec.density === "loose" || rec.density === "tight" ? rec.density : "medium";
  const vaultCol = rec.vaultCol === "narrow" || rec.vaultCol === "wide" ? rec.vaultCol : "medium";
  return { density, vaultCol };
}

/**
 * 渲染期空槽让位：模块可用性由案头级上下文判（信=有追踪、纸叠=有未读、墙=已登录、
 * 铺纸/报纸恒可用），整槽不可用则抽掉；抽完只剩「一槽 + 通栏槽」时把前者提满宽——
 * 复刻 2026-10 前版 asideEmpty 行为（右栏三件套全隐时铺纸占满整行）。不改动原数组。
 */
export function reflowDeskLayout(slots: readonly DeskSlot[], available: ReadonlySet<DeskModuleId>): DeskSlot[] {
  const kept = slots
    .map((slot) => ({ ...slot, items: slot.items.filter((id) => available.has(id)) }))
    .filter((slot) => slot.items.length > 0);
  // 只有「确有槽因可用性被抽掉」才提满宽——否则用户亲手存下的
  // [span2 + span3] 两槽版式会在渲染期被改写成 [span3 + span3]。
  const dropped = kept.length < slots.length;
  if (dropped && kept.length === 2 && kept[1]!.span === 3 && kept[0]!.span !== 3) {
    return [{ ...kept[0]!, span: 3 }, kept[1]!];
  }
  return kept;
}
