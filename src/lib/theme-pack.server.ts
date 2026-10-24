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
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
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
/** 各类包内文件的读取预检上限（健壮二批 R1）：statSync 阶段拒，不进 readFileSync。 */
const MANIFEST_MAX_BYTES = 256 * 1024;
// css 给 sanitize 的 64KB 真实拒因留余量：64~128KB 仍由 sanitize 报「超过 64KB」
const CSS_READ_MAX_BYTES = 128 * 1024;
/** zip 约束（R2）：盘上 64MB（读都不读）、条目 512、单条目解压量 2MB。 */
const ZIP_DISK_MAX = 64 * 1024 * 1024;
const ZIP_ENTRY_LIMIT = 512;
const ZIP_ENTRY_MAX = 2 * 1024 * 1024;

/**
 * 包内文件安全读取（安全批 R1）：realpath 双端归一后再前缀比对，防符号链接越界
 * ——pathResolve 是纯词法拼接（不解链接），readFileSync 却跟随链接，包内一个预制
 * 符号链接（或包目录本身是链接的路径段）即可读到包外本机文件；资产路由直接回
 * 字节、css 内容随 GET /api/themes 下发，都是外泄通道。manifest/css/资产三个
 * 读点全部走这里。zip 分支是内存键查找，无此面。返回 null = 越界/不存在/不可读
 * （调用方按各自语义降级：资产 404、css 记缺失、manifest 整包坏）。
 * 已知边界：TOCTOU（比对与读取之间链接被换）——本机单用户威胁模型下接受。
 */
function safeReadPackFile(packDir: string, rel: string, maxBytes: number): Buffer | null {
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
    // 读取预检（R1）：超限在 statSync 阶段拒——超大 manifest/css/资产不再整读进内存
    if (statSync(realTarget).size > maxBytes) return null;
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
/** 流式喂入粒度（评审 P2 收敛 64KB→8KB）：判决在 ondata、即整块同步解压完之后，
 * 所以块大小 = 瞬时峰值单位——流式分支 resize=true 内部缓冲动态翻倍，64KB 块最坏
 * 展开 66MB 实际瞬时分配可达 ~128MB 且每次强扫重付。8KB 块把峰值压到 ≤8MB、
 * 解码亚十毫秒；诚实包代价 = 32MB 极值 ≈4000 次 push ≈ 数十 ms，可忽略。
 * 碎回调守卫 4096 对单条 ≤2MB（8KB×256 块）仍有 16 倍余量。 */
const ZIP_FEED_CHUNK = 8 * 1024;
const zipCache = new Map<string, { mtime: number; size: number; files: Record<string, Uint8Array> }>();

function readZipFiles(zipPath: string): Record<string, Uint8Array> | null {
  try {
    const st = statSync(zipPath);
    if (hitStale(zipPath, st)) return zipCache.get(zipPath)!.files;
    // R2：盘上超 64MB 直接判坏——readFileSync 都不进（一个 zip 本不该比解压上限的两倍还大）
    if (st.size > ZIP_DISK_MAX) return null;
    // 三批终裁（zip-actual-output-cap）：声明尺寸三件套（sc/su/条目数）只是便宜
    // 的快速预检，**安全责任全部交给实际输出判决**——同步 inflate 的截断只丢
    // 字节不停工，「诚实压缩流 + 伪造小 originalSize」会解码到流尾，CPU ∝ 输入
    // ×1032 膨胀比。改用 fflate 流式 Unzip 分块喂入：ondata 拿到的是**实际**
    // 解压字节，超限即停止喂入——中止粒度 = 一个输入块（64KB→≤66MB 展开），
    // 攻击成本从「分钟级」缩到「亚秒级一次性」。
    const buf = new Uint8Array(readFileSync(zipPath));
    const files: Record<string, Uint8Array> = {};
    const parts = new Map<string, Uint8Array[]>();
    let actualTotal = 0;
    let entryCount = 0;
    let over = false;
    const uz = new Unzip();
    uz.register(UnzipInflate); // compression=8（zip 条目是 raw deflate）
    uz.register(UnzipPassThrough); // compression=0（stored）
    uz.onfile = (file) => {
      entryCount += 1;
      if (entryCount > ZIP_ENTRY_LIMIT) {
        over = true;
        return;
      }
      const chunks: Uint8Array[] = [];
      let fileLen = 0; // 本条目实际输出累计（O(1) 增量，勿在回调里 reduce）
      parts.set(file.name, chunks);
      file.ondata = (err, data) => {
        if (err) {
          over = true;
          return;
        }
        chunks.push(data);
        fileLen += data.length;
        actualTotal += data.length;
        // 病态碎回调（字节未超但回调数爆炸）与真实超限同判
        if (chunks.length > 4096 || fileLen > ZIP_ENTRY_MAX || actualTotal > ZIP_TOTAL_CAP) {
          over = true;
          return;
        }
      };
      try {
        file.start();
      } catch {
        over = true; // 不支持的压缩方法（start() 对未注册方法抛错）
      }
    };
    for (let o = 0; o < buf.length && !over; o += ZIP_FEED_CHUNK) {
      const end = Math.min(o + ZIP_FEED_CHUNK, buf.length);
      uz.push(buf.subarray(o, end), end === buf.length);
    }
    if (over) return null;
    for (const [name, chunks] of parts) {
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Uint8Array(total);
      let p = 0;
      for (const c of chunks) {
        out.set(c, p);
        p += c.length;
      }
      files[name] = out;
    }
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

function hitStale(zipPath: string, st: { mtimeMs: number; size: number }): boolean {
  const hit = zipCache.get(zipPath);
  return Boolean(hit) && hit!.mtime === st.mtimeMs && hit!.size === st.size;
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

/** 包内文本统一解码：folder 分支是 Buffer、zip 分支是 fflate 的裸 Uint8Array——
 * 后者 toString("utf8") 不是解码而是逗号数字串（TypedArray.toString 忽略参数），
 * 必须走 TextDecoder。 */
const packTextDecoder = new TextDecoder();

function buildCandidate(baseId: string, readFile: (rel: string, maxBytes: number) => Uint8Array | null): PackCandidate | null {
  const manifestBytes = readFile("kami-theme.json", MANIFEST_MAX_BYTES);
  if (manifestBytes === null) return null;
  // 记事本另存的 utf8-sig（BOM 头）会让 JSON.parse 失败——剥掉再解（AI 产物常见）
  const rawManifest = packTextDecoder.decode(manifestBytes).replace(/^\uFEFF/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    return null;
  }
  const result = parseThemeManifest(parsed);
  if (!result.ok) return null;
  let rawCss: string | null = null;
  if (result.manifest.css) {
    const cssBytes = readFile(result.manifest.css, CSS_READ_MAX_BYTES);
    rawCss = cssBytes === null ? null : packTextDecoder.decode(cssBytes);
  }
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
        cand = buildCandidate(stem, (rel, maxBytes) => safeReadPackFile(full, rel, maxBytes));
      } else {
        const files = readZipFiles(full);
        if (!files) {
          broken += 1;
          continue;
        }
        // zip 条目已整体在内存且经 filter 约束；单条目上限在此复检（缓存条目同语义）
        cand = buildCandidate(stem, (rel, maxBytes) => {
          const bytes = files[rel];
          return bytes && bytes.byteLength <= maxBytes ? bytes : null;
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
        // 兜底 try（R3 纵深）：净化器未来任何异常都降级为丢段，绝不外溢成列表 500
        try {
          const clean = sanitizeThemeCss(cand.rawCss, stem, cand.manifest.assets ?? []);
          if (clean.css === null) notes.push(clean.reason ?? "css 清洗失败");
          else {
            css = clean.css;
            if (clean.reason) notes.push(clean.reason);
          }
        } catch (err) {
          notes.push(`css 清洗异常：${err instanceof Error ? err.message : String(err)}`);
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
    // R1：词法前缀检查换 safeReadPackFile（realpath 归一）——符号链接不再越界；
    // 读取预检同函数内（2MB 超限 statSync 阶段拒）
    bytes = safeReadPackFile(folder, file, ASSET_MAX_BYTES);
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
