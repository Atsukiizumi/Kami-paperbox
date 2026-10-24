/**
 * 主题包服务端扫描与资产读取（everything can design · P2）。
 *
 * 作用：themes/ 目录只读扫描（文件夹与 zip 都认，zip 走 fflate 解在内存）、
 *      _template 模板自材料化、包内资产按白名单取出（防路径穿越）、
 *      「导出当前为主题包」落盘。全部校验复用 theme-pack.ts 纯函数口径。
 * 用法：路由 src/routes/api/themes.ts 调 scanThemePacks/readThemeAsset/
 *      exportThemePack/openThemesDir；测试直接调这些函数。
 * 为什么：应用对用户主题文件夹永远只读（除导出写入自己生成的新目录），
 *        坏包降级坏段跳过、坏包不列出，永不连坐默认观感。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { unzipSync } from "fflate";
import { resolveKamiRoot } from "./proxy.server.ts";
import {
  isSafePackPath,
  parseThemeManifest,
  safeThemeDirName,
  sanitizeThemeCss,
  THEME_PACK_ASSET_EXTS,
  uniquifyThemeDirName,
  type ThemePackInfo,
} from "./theme-pack.ts";
import { THEME_TEMPLATE_FILES } from "./theme-pack-template.ts";

export const THEME_PACK_SOFT_LIMIT = 50;
const ASSET_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 包内文件安全读取（安全批 R1）：realpath 双端归一后再前缀比对，防符号链接越界
 * ——pathResolve 是纯词法拼接（不解链接），readFileSync 却跟随链接，包内一个预制
 * 符号链接（或包目录本身是链接的路径段）即可读到包外本机文件；资产路由直接回
 * 字节、css 内容随 GET /api/themes 下发，都是外泄通道。manifest/css/资产三个
 * 读点全部走这里。zip 分支是内存键查找，无此面。返回 null = 越界/不存在/不可读
 * （调用方按各自语义降级：资产 404、css 记缺失、manifest 整包坏）。
 * 已知边界：TOCTOU（比对与读取之间链接被换）——本机单用户威胁模型下接受。
 */
function safeReadPackFile(packDir: string, rel: string): Buffer | null {
  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = realpathSync(join(packDir, rel));
    realRoot = realpathSync(packDir);
  } catch {
    return null;
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) return null;
  try {
    return readFileSync(realTarget);
  } catch {
    return null;
  }
}

/** themes/ 根目录：KAMI_ROOT/.data/themes——.data 是 Docker 卷（kami-data），
 * 放这里主题包才能在容器重建后幸存；dev 落在仓库 .data/（已 gitignore）。 */
export function themesDir(): string {
  return join(resolveKamiRoot(), ".data", "themes");
}

type ScanState = { dirMtime: number; packs: ThemePackInfo[]; overLimit: number; broken: number };

let scanState: ScanState | null = null;

/** zip 包的解压缓存：mtime+size 变了才重解；总量封顶防 zip 炸弹、条目超限逐出最旧。 */
const ZIP_TOTAL_CAP = 32 * 1024 * 1024;
const ZIP_CACHE_LIMIT = 8;
const zipCache = new Map<string, { mtime: number; size: number; files: Record<string, Uint8Array> }>();

function readZipFiles(zipPath: string): Record<string, Uint8Array> | null {
  try {
    const st = statSync(zipPath);
    const hit = zipCache.get(zipPath);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.files;
    // 安全批 R2：filter 在每条目 inflate 之前跑——按 originalSize 累计，超限条目
    // 不解压（zip 炸弹进不了内存；GET /api/themes 缓存未命中即触发扫描，guest
    // 可达，所以必须前置）。originalSize 缺失的极端构造按压缩比上界 400 估。
    let declaredTotal = 0;
    let overflow = false;
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)), {
      filter: (f) => {
        // fflate 0.8：filter 在 inflate 之前逐条目回调（源码核实），
        // originalSize 即解压后大小（zip 头字段）；缺失的极端构造按压缩比上界 400 估。
        const size = f.originalSize ?? f.size * 400;
        if (declaredTotal + size > ZIP_TOTAL_CAP) {
          overflow = true;
          return false;
        }
        declaredTotal += size;
        return true;
      },
    });
    if (overflow) return null;
    if (zipCache.size >= ZIP_CACHE_LIMIT) {
      const oldest = zipCache.keys().next().value;
      if (oldest !== undefined) zipCache.delete(oldest);
    }
    zipCache.set(zipPath, { mtime: st.mtimeMs, size: st.size, files });
    return files;
  } catch {
    return null;
  }
}

/** _template 自材料化：没有就写一份（已有则绝不覆盖用户的修改）。 */
function ensureTemplate(dir: string): void {
  const marker = join(dir, "_template", "kami-theme.json");
  if (existsSync(marker)) return;
  try {
    mkdirSync(join(dir, "_template", "assets"), { recursive: true });
    for (const [rel, content] of Object.entries(THEME_TEMPLATE_FILES)) {
      const target = join(dir, "_template", rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
  } catch {
    /* 只读介质 / 权限不足：模板缺席不阻断扫描 */
  }
}

type PackCandidate = {
  baseId: string;
  manifest: import("./theme-pack.ts").ThemePackManifest;
  dropped: string[];
  rawCss: string | null;
};

function buildCandidate(baseId: string, readText: (rel: string) => string | null): PackCandidate | null {
  const rawWithBom = readText("kami-theme.json");
  if (rawWithBom === null) return null;
  // 记事本另存的 utf8-sig（BOM 头）会让 JSON.parse 失败——剥掉再解（AI 产物常见）
  const rawManifest = rawWithBom.replace(/^\uFEFF/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    return null;
  }
  const result = parseThemeManifest(parsed);
  if (!result.ok) return null;
  let rawCss: string | null = null;
  if (result.manifest.css) rawCss = readText(result.manifest.css);
  return { baseId, manifest: result.manifest, dropped: [...result.dropped], rawCss };
}

/**
 * 扫描 themes/：跳 _ 前缀；文件夹与 zip 都认；**同茎并存时文件夹赢、zip 记坏**
 * （id 必须恒等于磁盘目录/文件名——资产路由按 id 找包，改名会断链）；mtime 缓存 + force 重扫。
 */
export function scanThemePacks(force = false): { dir: string; packs: ThemePackInfo[]; overLimit: number; broken: number } {
  const dir = themesDir();
  ensureTemplate(dir);
  let entries: string[] = [];
  let dirMtime = 0;
  try {
    entries = readdirSync(dir);
    dirMtime = statSync(dir).mtimeMs;
  } catch {
    return { dir, packs: [], overLimit: 0, broken: 0 };
  }
  if (!force && scanState && scanState.dirMtime === dirMtime) {
    return { dir, packs: scanState.packs, overLimit: scanState.overLimit, broken: scanState.broken };
  }

  const packs: ThemePackInfo[] = [];
  const stems = new Set<string>();
  let broken = 0;
  let overLimit = 0;
  for (const entry of entries.sort()) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let isDir = false;
    let isZip = false;
    try {
      const st = statSync(full);
      isDir = st.isDirectory();
      isZip = st.isFile() && entry.toLowerCase().endsWith(".zip");
    } catch {
      continue;
    }
    if (!isDir && !isZip) continue;
    const stem = isDir ? entry : entry.replace(/\.zip$/i, "");
    if (stems.has(stem)) {
      broken += 1; // 同茎文件夹+zip 并存：文件夹已收，zip 记坏不连坐
      continue;
    }
    let cand: PackCandidate | null = null;
    try {
      if (isDir) {
        cand = buildCandidate(stem, (rel) => {
          const bytes = safeReadPackFile(full, rel);
          return bytes ? bytes.toString("utf8") : null;
        });
      } else {
        const files = readZipFiles(full);
        if (!files) {
          broken += 1;
          continue;
        }
        cand = buildCandidate(stem, (rel) => {
          const bytes = files[rel];
          return bytes ? new TextDecoder().decode(bytes) : null;
        });
      }
    } catch {
      cand = null;
    }
    if (!cand) {
      broken += 1;
      continue;
    }
    stems.add(stem);
    if (packs.length >= THEME_PACK_SOFT_LIMIT) {
      overLimit += 1;
      continue;
    }
    const notes = [...cand.dropped];
    let css: string | null = null;
    if (cand.manifest.css) {
      if (cand.rawCss === null) notes.push(`css 文件缺失：${cand.manifest.css}`);
      else {
        const clean = sanitizeThemeCss(cand.rawCss, stem, cand.manifest.assets ?? []);
        if (clean.css === null) notes.push(clean.reason ?? "css 清洗失败");
        else {
          css = clean.css;
          if (clean.reason) notes.push(clean.reason);
        }
      }
    }
    packs.push({
      id: stem,
      name: cand.manifest.meta.name,
      author: cand.manifest.meta.author,
      version: cand.manifest.meta.version,
      status: notes.length > 0 ? "degraded" : "ok",
      dropped: notes,
      hasCss: css !== null,
      hasPreview: Boolean(cand.manifest.preview),
      css,
      manifest: cand.manifest,
    });
  }
  scanState = { dirMtime, packs, overLimit, broken };
  return { dir, packs, overLimit, broken };
}

const MIME_BY_EXT: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/**
 * 包内资产读取：pack 必须在扫描列表里、file 必须是该包声明过的
 * （assets/css/preview 之一）、扩展名在白名单、≤2MB；folder 包再做
 * resolved-path 前缀防穿越；zip 包查解压缓存。
 */
export function readThemeAsset(
  packId: string,
  file: string,
): { ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string; status: number } {
  if (!isSafePackPath(packId) || !isSafePackPath(file)) {
    return { ok: false, error: "非法路径", status: 400 };
  }
  const ext = extname(file).slice(1).toLowerCase();
  if (!THEME_PACK_ASSET_EXTS.includes(ext)) {
    return { ok: false, error: `不支持的文件类型：${ext || "(无)"}`, status: 400 };
  }
  const { packs } = scanThemePacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return { ok: false, error: `主题包不存在：${packId}`, status: 404 };
  const declared =
    (pack.manifest.assets ?? []).some((a) => a.file === file) ||
    pack.manifest.css === file ||
    pack.manifest.preview === file;
  if (!declared) return { ok: false, error: `该文件未在包内声明：${file}`, status: 403 };

  let bytes: Uint8Array | null = null;
  const dir = themesDir();
  const folder = join(dir, packId);
  if (existsSync(folder)) {
    // R1：词法前缀检查换 safeReadPackFile（realpath 归一）——符号链接不再越界
    bytes = safeReadPackFile(folder, file);
  } else {
    bytes = readZipFiles(join(dir, `${packId}.zip`))?.[file] ?? null;
  }
  if (!bytes) return { ok: false, error: `文件缺失：${file}`, status: 404 };
  if (bytes.byteLength > ASSET_MAX_BYTES) {
    return { ok: false, error: "文件超过 2MB 上限", status: 413 };
  }
  return { ok: true, bytes, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}

/** 「导出当前为主题包」：服务端复验 manifest，安全目录名落盘，失效扫描缓存。 */
export function exportThemePack(manifestRaw: unknown): { ok: true; id: string; dir: string } | { ok: false; error: string } {
  const result = parseThemeManifest(manifestRaw);
  if (!result.ok) return { ok: false, error: result.reason };
  const dir = themesDir();
  const base = safeThemeDirName(result.manifest.meta.name);
  let name = base;
  try {
    mkdirSync(dir, { recursive: true });
    const existing = new Set(readdirSync(dir).map((e) => e.replace(/\.zip$/i, "")));
    name = uniquifyThemeDirName(base, existing);
    const packDir = join(dir, name);
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "kami-theme.json"), JSON.stringify(result.manifest, null, 2), "utf8");
  } catch (err) {
    return { ok: false, error: `写入失败：${err instanceof Error ? err.message : String(err)}` };
  }
  scanState = null;
  zipCache.clear();
  return { ok: true, id: name, dir: join(dir, name) };
}

/** 打开主题文件夹（系统文件管理器）；目录不存在则先建。 */
export function openThemesDir(): { ok: boolean; dir: string } {
  const dir = themesDir();
  try {
    mkdirSync(dir, { recursive: true });
    ensureTemplate(dir);
    const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, dir };
  } catch {
    return { ok: false, dir };
  }
}
