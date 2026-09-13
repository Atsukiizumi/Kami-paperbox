/**
 * 上游 JSON 清洗四件套的唯一定义（TD-32 / M10）。
 *
 * 作用：全仓此前有 7 处 asRecord/asString/asNumber/asBool 复制且语义微差——
 *      数组是否算对象、trim 与否、布尔是否转字符串、失败返 {} 还是 null。
 *      本模块把语义差异「命名化」，行为逐一保真，不再复制。
 *
 * 变体选择指南（原实现 → 用哪个）：
 * - http.ts / booru.ts 家族（数组当对象、布尔转字符串）→ asRecord / asString / asNumber / asBool
 * - pixiv-feed.ts / site-identity.ts（trim、不认布尔）  → asRecordStrict / asStringTrimmed
 * - reverse-search.ts / social.ts（不 trim、不认布尔）  → asStringLoose
 * - throttle.ts（数组不算对象）                          → asRecordStrict
 * - backup.ts（数组不算对象且失败要区分 null）           → asRecordOrNull
 */

/** 宽松对象：非 null 对象原样返回（**数组通过**），其余回 fallback。 */
export function asRecord(v: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : fallback;
}

/** 严格对象：**数组不算**，非 null 对象原样返回，其余回 fallback。 */
export function asRecordStrict(v: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fallback;
}

/** 严格对象或 null：数组/非对象返回 null——调用方需要区分「坏数据」与「空对象」时用。 */
export function asRecordOrNull(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** 字符串（bool 感知）：string 原样 / 有限 number 转 string / **boolean 转 "true"/"false"** / fallback。 */
export function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return fallback;
}

/** 朴素字符串：string 原样 / 有限 number 转 string / fallback（**不认布尔**、不 trim）。 */
export function asStringLoose(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

/** 去空格字符串：string **trim** / 有限 number 转 string / fallback（不认布尔）。 */
export function asStringTrimmed(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

/** 数字：有限 number 原样 / 非空数值字符串转数字 / fallback。 */
export function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

/** 布尔：仅 === true 为真（图站 JSON 的真值字段都是显式布尔）。 */
export function asBool(v: unknown): boolean {
  return v === true;
}
