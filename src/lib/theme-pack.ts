/**
 * 主题包纯数据层（everything can design · P2）。
 *
 * 作用：kami-theme.json 的解析与段级降级（坏段丢段、坏包整包拒）、theme.css
 *      的安全清洗（url 白名单重写 / 禁 import / 大小上限）、「导出当前为
 *      主题包」的 manifest 组装、主题目录名清洗。零 IO，node --test 表驱动。
 * 用法：theme-pack.server.ts 扫描时调 parseThemeManifest + sanitizeThemeCss；
 *      appearance.tsx 导出时调 composeExportManifest；写目录前调 safeThemeDirName。
 * 为什么：校验必须是纯函数三方共用（扫描 / 导出 / 将来 Agent 模板文档），
 *        降级矩阵的口径只有一份。
 */
import { hasValidDeskSlot, parseDeskLayout, parseShell, parseShellCustom, type DeskLayout, type ShellSettings } from "./desk-layout.ts";
import { THEME_LIST, type ThemeId, type ThemeTokens } from "./theme.ts";

export const THEME_PACK_SCHEMA_VERSION = 1;

/** 主题包内允许引用的资产扩展名（资产路由按 ext 定 Content-Type 也用这份）。 */
export const THEME_PACK_ASSET_EXTS: readonly string[] = [
  "woff2", "woff", "ttf", "otf", "png", "jpg", "jpeg", "webp", "avif", "svg",
];

export type ThemePackManifest = {
  kamitheme: typeof THEME_PACK_SCHEMA_VERSION;
  meta: { name: string; author?: string; version?: string; description?: string };
  palette?: { base?: ThemeId; overrides?: Partial<Record<keyof ThemeTokens, string>> };
  shell?: ShellSettings;
  layout?: DeskLayout;
  css?: string;
  assets?: { id: string; file: string }[];
  preview?: string;
};

/** 段级降级后的解析产物：ok 时 dropped 记录被丢弃的段与原因（管理页展示）。 */
export type ThemePackParseResult =
  | { ok: true; manifest: ThemePackManifest; dropped: string[] }
  | { ok: false; reason: string };

/** 扫描结果里单个包的信息（列表 + 管理页状态徽标用）。 */
export type ThemePackInfo = {
  id: string;
  name: string;
  author?: string;
  version?: string;
  /** ok = 全段可用；degraded = 部分段被丢（dropped 给原因）；broken 包不进列表。 */
  status: "ok" | "degraded";
  dropped: string[];
  hasCss: boolean;
  hasPreview: boolean;
  /** 已清洗的 css 内容（随列表下发，客户端直接注入）。 */
  css: string | null;
  manifest: ThemePackManifest;
};

const COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\([^()]{1,60}\)$|^oklch\([^()]{1,60}\)$/;
const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CSS_MAX_BYTES = 64 * 1024;
const CSS_DATA_URL_MAX = 8 * 1024;

/** 包内相对路径白名单：正斜杠、无 ..、非 / 开头、≤120 字符、无控制字符。 */
export function isSafePackPath(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > 120) return false;
  // eslint-disable-next-line no-control-regex -- 就是要拒路径里的控制字符
  if (v.startsWith("/") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return false;
  return v.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && THEME_LIST.some((d) => d.id === v);
}

/**
 * manifest 解析 + 段级降级：kamitheme 版本不认或 meta.name 缺 → 整包拒；
 * palette/shell/layout/css/assets/preview 段脏 → 丢段记原因（shell 复用
 * parseShell 的白名单、layout 复用 parseDeskLayout 的清洗，口径与 P1 同源）。
 */
export function parseThemeManifest(raw: unknown): ThemePackParseResult {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!rec) return { ok: false, reason: "manifest 不是 JSON 对象" };
  if (rec.kamitheme !== THEME_PACK_SCHEMA_VERSION) {
    return { ok: false, reason: `不认识的 kamitheme 版本：${String(rec.kamitheme)}` };
  }
  const meta = rec.meta && typeof rec.meta === "object" ? (rec.meta as Record<string, unknown>) : {};
  const name = typeof meta.name === "string" ? meta.name.trim().slice(0, 24) : "";
  if (!name) return { ok: false, reason: "meta.name 缺失或为空" };
  const manifest: ThemePackManifest = {
    kamitheme: THEME_PACK_SCHEMA_VERSION,
    meta: { name },
  };
  if (typeof meta.author === "string" && meta.author.trim()) manifest.meta.author = meta.author.trim().slice(0, 40);
  if (typeof meta.version === "string" && meta.version.trim()) manifest.meta.version = meta.version.trim().slice(0, 16);
  if (typeof meta.description === "string" && meta.description.trim()) {
    manifest.meta.description = meta.description.trim().slice(0, 120);
  }
  const dropped: string[] = [];

  if (rec.palette !== undefined) {
    const p = rec.palette && typeof rec.palette === "object" ? (rec.palette as Record<string, unknown>) : null;
    const palette: NonNullable<ThemePackManifest["palette"]> = {};
    if (isThemeId(p?.base)) palette.base = p.base;
    else if (p?.base !== undefined) dropped.push("palette.base 不是内置主题");
    const ov = p?.overrides && typeof p.overrides === "object" ? (p.overrides as Record<string, unknown>) : null;
    if (ov) {
      const cleaned: Partial<Record<keyof ThemeTokens, string>> = {};
      const validKeys = THEME_TOKEN_KEYS;
      for (const [k, v] of Object.entries(ov)) {
        if (validKeys.includes(k as keyof ThemeTokens) && typeof v === "string" && COLOR_RE.test(v)) {
          (cleaned as Record<string, string>)[k] = v;
        }
      }
      if (Object.keys(cleaned).length > 0) palette.overrides = cleaned;
    }
    if (palette.base !== undefined || palette.overrides !== undefined) manifest.palette = palette;
    else dropped.push("palette 段没有可用内容，已跳过");
  }

  if (rec.shell !== undefined) {
    const s = rec.shell && typeof rec.shell === "object" ? (rec.shell as Record<string, unknown>) : null;
    const parsed = parseShell(s);
    // parseShell 对非法形态静默回 desk——包语义要求形态必须显式合法才算这段有效
    if (s && typeof s.form === "string" && parsed.form === s.form) {
      manifest.shell = parsed;
      // P3：custom 形态的宽度钳制是「修复动作」——settings 层静默用钳制值，
      // manifest 层记入 dropped（管理页「部分生效」+ 原因）。
      if (parsed.form === "custom") dropped.push(...parseShellCustom(s.custom).clamped);
    } else dropped.push("shell 形态不合法，已跳过");
  }

  if (rec.layout !== undefined) {
    // 降级矩阵（P2 修订）：layout 脏值丢段而不是静默回出厂默认——
    // 否则跟随布局的用户激活坏包，自己调过的案头会被悄悄重置。
    const raw = rec.layout && typeof rec.layout === "object" ? (rec.layout as Record<string, unknown>) : null;
    if (!raw || !Array.isArray(raw.slots) || !hasValidDeskSlot(raw.slots)) {
      dropped.push("layout 段不是有效槽模型，已跳过");
    } else {
      manifest.layout = parseDeskLayout(rec.layout);
    }
  }

  if (rec.css !== undefined) {
    if (isSafePackPath(rec.css)) manifest.css = rec.css;
    else dropped.push("css 路径不合法，已跳过");
  }

  if (rec.assets !== undefined) {
    const list = Array.isArray(rec.assets) ? rec.assets : [];
    const out: { id: string; file: string }[] = [];
    const seen = new Set<string>();
    for (const a of list) {
      const item = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
      const id = typeof item?.id === "string" ? item.id : "";
      const file = typeof item?.file === "string" ? item.file : "";
      if (ASSET_ID_RE.test(id) && isSafePackPath(file) && !seen.has(file)) {
        seen.add(file);
        out.push({ id, file });
      }
      if (out.length >= 32) break;
    }
    if (out.length > 0) manifest.assets = out;
    else dropped.push("assets 段没有合法条目，已跳过");
  }

  if (rec.preview !== undefined) {
    if (isSafePackPath(rec.preview)) manifest.preview = rec.preview;
    else dropped.push("preview 路径不合法，已跳过");
  }

  return { ok: true, manifest, dropped };
}

/** theme.css 的 token 键（palette.overrides 的白名单）。 */
const THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[] = [
  "bg", "surface", "elevated", "fg", "muted", "subtle", "accent", "accentFg", "danger", "ok",
];

/**
 * CSS 转义归一化：`\XXXXXX␣`（1-6 位十六进制，后随可选一个空白）与 `\c`（非十六进制
 * 字面转义）解码为明文——这正是绕过清洗字面匹配的向量（`u\72l(` 浏览器按 url() 解析），
 * 先解码再查，所有禁令落在明文上。单遍解码与浏览器语义一致（产出物不再二次解码）：
 * `\\` 还原成字面反斜杠后其后的字符不会再参与转义；`\`+换行 = 字符串续行，两者皆消；
 * `\0` 按规范映射 U+FFFD；串尾孤立 `\` 原样保留（浏览器同样按字面处理，不构成绕过）。
 */
export function normalizeCssEscapes(css: string): string {
  let out = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = css[i + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    if (next === "\n" || next === "\r" || next === "\f") {
      // 续行：反斜杠与换行一起消失；CRLF 是一对续行符，两者皆消
      // （只消 \r 留 \n 会让 u\<CRLF>rl( 在浏览器拼成 url( 而我方拼不成——缝隙）
      i += next === "\r" && css[i + 2] === "\n" ? 2 : 1;
      continue;
    }
    let j = i + 1;
    let hex = "";
    while (j < css.length && hex.length < 6 && /[0-9a-fA-F]/.test(css[j]!)) {
      hex += css[j]!;
      j += 1;
    }
    if (hex.length > 0) {
      const code = Number.parseInt(hex, 16);
      const after = css[j];
      // 十六进制转义后的一个空白按规范消耗；CRLF 同为一对
      if (after === "\r" && css[j + 1] === "\n") j += 2;
      else if (after === " " || after === "\t" || after === "\n" || after === "\r" || after === "\f") j += 1;
      // CSS Syntax §4.3.2 consume-escaped：0、代理区、超出 Unicode 上限（如 \FFFFFF）
      // 一律替换 U+FFFD——直接 fromCodePoint 会抛 RangeError 并把列表打成 500
      const badCode = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
      out += badCode ? "\uFFFD" : String.fromCodePoint(code);
      i = j - 1;
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

/**
 * theme.css 安全清洗：返回 null = 整段拒（含原因）；否则返回清洗后的 css
 * （url() 只保留两类：声明的包内资产 → 重写为本站资产路由；小型 data: 位图。
 * 其余 url 一律换成 none）。入口先做转义归一化——@import / image-set /
 * expression / javascript: / 全局选择器 / url 重写全部吃明文，转义变体落网。
 */
export function sanitizeThemeCss(
  css: string,
  themeId: string,
  assets: readonly { id: string; file: string }[],
): { css: string | null; reason?: string } {
  if (css.length > CSS_MAX_BYTES) return { css: null, reason: `css 超过 ${CSS_MAX_BYTES / 1024}KB 上限` };
  // 转义归一化（R3）：长度按原文计（防归一化膨胀放大），其余检查全部吃明文。
  css = normalizeCssEscapes(css);
  if (css.includes("\u0000")) return { css: null, reason: "css 含 NUL 字符，已整段拒绝" };
  const lower = css.toLowerCase();
  if (lower.includes("@import")) return { css: null, reason: "css 含 @import，已整段拒绝" };
  if (lower.includes("expression(") || lower.includes("javascript:")) {
    return { css: null, reason: "css 含危险构造（expression/javascript:），已整段拒绝" };
  }
  // image-set() 的字符串形式不走 url()，能绕开白名单外呼网络——整段拒。
  if (lower.includes("image-set(")) {
    return { css: null, reason: "css 含 image-set()，已整段拒绝（外呼风险）" };
  }
  // 作用域约束（部分执行）：裸 html/body/:root/* 全局选择器不允许——
  // 主题样式只该落在 html[data-kami-theme] 作用域内（模板与提示词均已引导）。
  const globalSel = /(^|\}|,)\s*(html|body|:root|\*)\s*(,|:|[.+~> ]*\{)/.exec(css);
  if (globalSel && !/html\[data-kami-theme/.test(globalSel[0])) {
    return { css: null, reason: `css 含未裹作用域的全局选择器（${globalSel[0].trim().slice(0, 20)}…），已整段拒绝` };
  }
  const assetFiles = new Set(assets.map((a) => a.file));
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let hitForbidden = false;
  const out = css.replace(urlRe, (full, _q: string, url: string) => {
    const v = url.trim();
    const dataM = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.exec(v);
    if (dataM && v.length <= CSS_DATA_URL_MAX) return full;
    if (assetFiles.has(v)) {
      const enc = encodeURIComponent(themeId) + "&file=" + encodeURIComponent(v);
      return `url("/api/themes/asset?theme=${enc}")`;
    }
    hitForbidden = true;
    return "none";
  });
  // 未声明的 url 全部换成 none 是可继续的降级；只有结构性危险才整段拒
  return { css: out, reason: hitForbidden ? "部分 url() 未声明为资产，已替换为 none" : undefined };
}

/** 「导出当前为主题包」：把当前配色/外壳/版式组装成 manifest（客户端组装、服务端复验）。 */
export function composeExportManifest(input: {
  name: string;
  theme: ThemeId;
  shell: ShellSettings;
  layout: DeskLayout;
}): ThemePackManifest {
  const manifest: ThemePackManifest = {
    kamitheme: THEME_PACK_SCHEMA_VERSION,
    meta: { name: input.name.trim().slice(0, 24) || "我的主题", author: "Kami 纸匣导出" },
    palette: { base: input.theme },
    shell: input.shell,
    layout: input.layout,
  };
  if (Object.keys(input.shell.tweaks).length === 0 && input.shell.form === "desk") delete manifest.shell;
  return manifest;
}

/** 主题目录名清洗：去文件系统非法字符/空白/点段与 Windows 保留名，40 字符封顶。 */
export function safeThemeDirName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|\s.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return "theme";
  return cleaned;
}

/** 目录名去重：与 existing 撞名时加 -2、-3…（扫描与导出共用）。 */
export function uniquifyThemeDirName(name: string, existing: ReadonlySet<string>): string {
  if (!existing.has(name)) return name;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${name}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${name}-${Date.now().toString(36)}`;
}

/** 主题包设置段（store v19）：包本体是文件不进同步，只同步指针与跟随开关。 */
export type ThemePackSettings = { activeId: string | null; followShell: boolean; followLayout: boolean };

export const DEFAULT_THEME_PACK: ThemePackSettings = { activeId: null, followShell: true, followLayout: true };

/** 设置段清洗：activeId 必须是非空短字符串（服务端还会对照扫描列表）；跟随开关缺省 true。 */
export function parseThemePackSettings(raw: unknown): ThemePackSettings {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const activeId =
    typeof rec.activeId === "string" && rec.activeId.trim() ? rec.activeId.trim().slice(0, 80) : null;
  return {
    activeId,
    followShell: rec.followShell !== false,
    followLayout: rec.followLayout !== false,
  };
}
