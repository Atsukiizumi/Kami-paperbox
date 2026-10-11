/**
 * 文件夹导入的路径反解与导入计划（design 2.1/2.4）。
 *
 * 作用：parseImportPath 把扫描到的相对路径按下载模板逆向切成 source/id/page/title/author，
 *      切不动给归类失败（no-match / unknown-source），不猜站点；planFolderImport 把
 *      扫描结果组装成导入计划（已在匣跳过、按页去重、缺站点归类）；scanFolderForImport /
 *      collectExistingKeys / executeImportPlan 是对应的 IO 链。
 * 用法：parseImportPath(file.path, settings.pathTemplate)——模板即 download-path.ts 的
 *      七预设 / custom 字符串；ImportScanResult 由 listRelativeFiles 的句柄经 getFile() 解出。
 * 为什么：反解是 formatDownloadPath 的逆向——模板驱动捕获组正则，七预设逐条代入无歧义
 *      （design 2.1 逐条模拟）；认不出的文件进无法识别清单而不是猜一个站点补 key。
 */
import { isSource } from "../sites.ts";
import { ensureFolderPermission, IMAGE_FILE_EXTS, listRelativeFiles } from "../folder-access.ts";
import type { Source, VaultMeta } from "../types.ts";
import { listVault, putVaultMeta, workKey } from "./vault.ts";
import { listServerVault, pushVaultMetaToServer } from "./vault-sync.ts";
import { rememberVaultKey, useVaultIndex } from "./vault-index.ts";

/**
 * 单文件反解结果。
 *
 * 成功侧 source 仅有 {source} 模板（site-author）能给：缺站点不是本层失败，
 * 由批级站点选择兜（design 2.2）。失败两归类：no-match = 模板正则与纯数字
 * basename 兜底都没中；unknown-source = {source} 捕获过 isSource（原样 + 小写
 * 一次）仍不认识——到此为止，不再兜底（「未知站点」不猜）。
 */
export type ImportPathParse =
  | { ok: true; source?: Source; id: string; page?: number; title?: string; author?: string }
  | { ok: false; reason: "no-match" | "unknown-source" };

/**
 * 扫描单文件：listRelativeFiles 的句柄经 getFile() 解出统计后的形状。
 * savedAt 取 page-0 文件的 lastModified（date/datetime 模板的页路径重建与
 * 回忆流分月都吃它）、bytes 取各文件 size 之和，数据源都在这里。
 */
export type ImportScanResult = {
  path: string;
  size: number;
  lastModified: number;
};

/** 反解要消费的字段槽位；其余 token（date/time/...）只参与定位，不捕获。 */
type Slot = "source" | "author" | "id" | "page" | "page1" | "title";

// 与 download-path.ts pathTokens 的产出同形（design 2.1 token 表）：整段成分锁死
// `[^/\\]+`（位置由模板钉死）、{id} 非贪 + 后随字面量 `_p` 切准、{title} 贪婪靠
// `\.{ext}$` 锚尾。{ext} 词表即 IMAGE_FILE_EXTS（枚举过滤同一份，长词在前免回溯）。
const EXT_ALTERNATION = [...IMAGE_FILE_EXTS].sort((a, b) => b.length - a.length).join("|");

const TOKEN_BODIES: Record<string, { slot: Slot | null; body: string }> = {
  source: { slot: "source", body: "[^/\\\\]+" },
  author: { slot: "author", body: "[^/\\\\]+" },
  authorId: { slot: null, body: "[^/\\\\]+" },
  tags: { slot: null, body: "[^/\\\\]+" },
  date: { slot: null, body: "\\d{4}-\\d{2}-\\d{2}" },
  time: { slot: null, body: "\\d{6}" },
  year: { slot: null, body: "\\d{4}" },
  month: { slot: null, body: "\\d{2}" },
  day: { slot: null, body: "\\d{2}" },
  hour: { slot: null, body: "\\d{2}" },
  minute: { slot: null, body: "\\d{2}" },
  second: { slot: null, body: "\\d{2}" },
  id: { slot: "id", body: "[^/\\\\]+?" },
  page: { slot: "page", body: "\\d+" },
  page1: { slot: "page1", body: "\\d+" },
  title: { slot: "title", body: ".+" },
  ext: { slot: null, body: `(?:${EXT_ALTERNATION})` },
};

const TOKEN_SCAN = /\{([a-z0-9]+)\}/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CompiledTemplate = { re: RegExp; slots: Slot[] };

function compileTemplate(template: string): CompiledTemplate {
  const slots: Slot[] = [];
  const source = template
    .split("/")
    .map((segment) => {
      let body = "";
      let last = 0;
      for (const m of segment.matchAll(TOKEN_SCAN)) {
        body += escapeRegExp(segment.slice(last, m.index));
        const token = TOKEN_BODIES[m[1].toLowerCase()];
        // 未知 token 按空串：正向 formatDownloadPath 对未知 token 就地丢弃，反解对齐同一定向
        if (token) {
          if (token.slot) {
            slots.push(token.slot);
            body += `(${token.body})`;
          } else {
            body += `(?:${token.body})`;
          }
        }
        last = m.index + m[0].length;
      }
      body += escapeRegExp(segment.slice(last));
      return `(?:${body})`;
    })
    .join("\\/");
  return { re: new RegExp(`^${source}$`), slots };
}

// 单条缓存：一批只有一个 pathTemplate（design 2.1「构造一次、全体复用」），
// parseImportPath 作为逐文件入口靠它免掉每文件重编译。
let compiledCache: { template: string; compiled: CompiledTemplate } | null = null;

function compiledFor(template: string): CompiledTemplate {
  if (compiledCache?.template !== template) {
    compiledCache = { template, compiled: compileTemplate(template) };
  }
  return compiledCache.compiled;
}

// 纯数字文件名兜底（模板正则没中再试，只看 basename）：{id}.jpg、{id}_p0.png、
// {id}_p0_无题.jpg 这类无标题短名；大小写敏感与模板 {ext} 同口径（白名单不猜）。
const NUMERIC_BASE_FALLBACK = new RegExp(`^(\\d+)(?:_p(\\d+))?(?:_.*)?\\.(?:${EXT_ALTERNATION})$`);

function pageOf(captured: Map<Slot, string>): number | undefined {
  const page = captured.get("page");
  if (page !== undefined) return Number(page);
  const page1 = captured.get("page1");
  // {page1} 是 1-based（正向 page1 = page + 1 恒 ≥ 1）：反解减一；捕获到 0 是外来
  // 值，钳回第 0 页，不产出负页。
  if (page1 !== undefined) return Math.max(0, Number(page1) - 1);
  return undefined;
}

/**
 * 反解单条相对路径（两段式）：先模板捕获组正则，模板没中或反解不出 {id} 再试
 * 纯数字 basename 兜底；两段都失败归 no-match。
 *
 * 反斜杠先归一 `/`（防御：正常流里 listRelativeFiles 自拼 `/`，不出现反斜杠）。
 * 已知边界（design 2.1）：贪婪段（{author}/{tags}）与非贪 {id} 在同一段直接相邻
 * 的 custom 模板可能静默错切——七个预设均无此形态，错切风险由 custom 自担。
 */
export function parseImportPath(path: string, template: string): ImportPathParse {
  const normalized = path.replaceAll("\\", "/");
  const { re, slots } = compiledFor(template);
  const m = re.exec(normalized);
  if (m) {
    const captured = new Map<Slot, string>();
    slots.forEach((slot, i) => captured.set(slot, m[i + 1]));
    // {source} 校验：先原样、再小写一次（用户手摆 "Pixiv" 文件夹属规范化）；
    // 仍不认识即未知站点，不猜也不兜底
    const rawSource = captured.get("source");
    let source: Source | undefined;
    if (rawSource !== undefined) {
      const lowered = rawSource.toLowerCase();
      const folded = isSource(rawSource) ? rawSource : isSource(lowered) ? lowered : null;
      if (folded === null) return { ok: false, reason: "unknown-source" };
      source = folded;
    }
    const id = captured.get("id");
    if (id !== undefined) {
      return {
        ok: true,
        source,
        id,
        page: pageOf(captured),
        title: captured.get("title"),
        author: captured.get("author"),
      };
    }
    // 模板无 {id}（退化 custom）：建不出 workKey，等同未中，掉到兜底
  }
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const fb = NUMERIC_BASE_FALLBACK.exec(base);
  if (!fb) return { ok: false, reason: "no-match" };
  return {
    ok: true,
    source: undefined,
    id: fb[1],
    page: fb[2] !== undefined ? Number(fb[2]) : undefined,
    title: undefined,
    author: undefined,
  };
}

// ── 导入计划（纯函数）─────────────────────────────────────────────

/** 计划的一条：一个唯一 (source,id)，meta 已按 design 2.4 字段表组装好，files 是去重后的页文件。 */
export type ImportPlanRecord = {
  meta: VaultMeta;
  files: ImportScanResult[];
};

export type ImportPlan = {
  records: ImportPlanRecord[];
  /** 唯一 key 命中已在匣的组数（幂等重跑时这就是全部增量）。 */
  skippedInVault: number;
  /** 反解失败 / 站点不明 / 缺站点未指认的文件路径（只列清单不指认，PRD L2）。 */
  unrecognized: string[];
};

type ImportGroup = {
  source: Source;
  id: string;
  title?: string;
  author?: string;
  entries: { page: number | undefined; file: ImportScanResult }[];
};

function buildRecord(
  group: ImportGroup,
  pages: { page: number | undefined; file: ImportScanResult }[],
  folderLabel?: string,
): ImportPlanRecord {
  // 代表文件 = 本记录的第 0 页：有页码取 page 0；无页码模板的单文件记录它自己
  // 就是第 0 页（savedAt 落真实时刻、previewFromFolder 有路径可读，都不该回退当下）；
  // 多页但缺 page-0 才真正走 Date.now() 兜底。
  const page0 = pages.find((p) => p.page === 0) ?? (pages.length === 1 ? pages[0] : undefined);
  const page0File = page0?.file;
  return {
    meta: {
      key: workKey(group.source, group.id),
      source: group.source,
      id: group.id,
      // design 2.4：title 用反解 {title}（sanitize 后形态）或 id 占位，后续补全档案；
      // author 同理是反解段或空串，authorId 无来源留空。
      title: group.title ?? group.id,
      author: group.author ?? "",
      authorId: "",
      tags: [],
      pageCount: pages.length,
      // ⚠ savedAt 取代表文件（第 0 页）的 lastModified：date/datetime 模板的多页路径重建
      // 与回忆流真实分月都吃它，用 Date.now() 会让页路径与月份全错。
      savedAt: page0File ? page0File.lastModified : Date.now(),
      bytes: pages.reduce((n, p) => n + p.file.size, 0),
      relativePath: page0File?.path,
      folderLabel,
      hasFile: false,
      origin: "folder",
      replaced: false,
    },
    files: pages.map((p) => p.file),
  };
}

/**
 * 把扫描结果按当前模板反解并组装成导入计划（纯函数，不碰 IO）。
 *
 * 作用：逐文件 parseImportPath → 无 source 的匹配文件注入批级站点（未选站前整组
 * 停在无法识别，design 2.2 已拍板）→ 按 (source,id) 分组，已在匣 key 整组跳过；
 * 组内有页码的按页去重（同页双扩展名取先见者）合成一条，无页码的每文件各成一条
 * pageCount=1。
 * 用法：planFolderImport(scan, settings.pathTemplate, existingKeys, { batchSource, folderLabel })。
 * 为什么：计划先于写入成型，预览（N/M/K）与执行共用同一份；纯函数让「选了站点后
 * 计划怎么变」可以在 Node 测试里锁住。
 */
export function planFolderImport(
  files: readonly ImportScanResult[],
  template: string,
  existingKeys: ReadonlySet<string>,
  opts?: { batchSource?: Source; folderLabel?: string },
): ImportPlan {
  const groups = new Map<string, ImportGroup>();
  const unrecognized: string[] = [];
  for (const file of files) {
    const parsed = parseImportPath(file.path, template);
    if (!parsed.ok) {
      unrecognized.push(file.path);
      continue;
    }
    const source = parsed.source ?? opts?.batchSource;
    if (!source) {
      unrecognized.push(file.path);
      continue;
    }
    const key = workKey(source, parsed.id);
    const group = groups.get(key);
    const entry = { page: parsed.page, file };
    if (group) {
      group.entries.push(entry);
      // 组 title/author 优先模板命中条目：改名散文件（纯数字兜底）先到会把整组
      // 退化成 id 占位（trellis-check P1 附带）——有 {title}/{author} 捕获才覆盖
      if (parsed.title) group.title = parsed.title;
      if (parsed.author) group.author = parsed.author;
    } else {
      groups.set(key, {
        source,
        id: parsed.id,
        title: parsed.title,
        author: parsed.author,
        entries: [entry],
      });
    }
  }
  const records: ImportPlanRecord[] = [];
  let skippedInVault = 0;
  for (const group of groups.values()) {
    if (existingKeys.has(workKey(group.source, group.id))) {
      skippedInVault += 1;
      continue;
    }
    const seenPages = new Map<number, { page: number; file: ImportScanResult }>();
    const unpaged: ImportScanResult[] = [];
    for (const { page, file } of group.entries) {
      if (page === undefined) unpaged.push(file);
      else if (!seenPages.has(page)) seenPages.set(page, { page, file });
    }
    const paged = [...seenPages.values()].sort((a, b) => a.page - b.page);
    if (paged.length > 0) records.push(buildRecord(group, paged, opts?.folderLabel));
    // 混合组（模板带页 + 改名散文件走兜底）：paged 已成记录，unpaged 再立同 key
    // 记录会在 IDB put 后写胜，把多页记录覆盖成 pageCount=1 的错形态且重跑无法自愈
    // （trellis-check P1）。与「不猜」同口径：无法归位的散文件进无法识别清单。
    // 纯 page-less 模板的同 id 多文件仍各成一条（先见者语义不变）。
    else {
      for (const file of unpaged) {
        records.push(buildRecord(group, [{ page: undefined, file }], opts?.folderLabel));
      }
    }
    if (paged.length > 0) {
      for (const file of unpaged) unrecognized.push(file.path);
    }
  }
  return { records, skippedInVault, unrecognized };
}

// ── 导入 IO 链（非纯函数，design 2.4）────────────────────────────

/**
 * 扫描授权文件夹，解出每个图片文件的统计（导入第一步）。
 *
 * 作用：ensureFolderPermission → listRelativeFiles → 逐句柄 getFile() 解
 * size/lastModified；onProgress 按已解文件数回报（调用方每 200 刷一次 toast）。
 * 用法：scanFolderForImport({ onProgress })；未授权抛错，由调用方提示。
 * 为什么：枚举快、逐文件 stat 慢，进度只挂在 stat 循环上；枚举后消失的文件
 * （并发移动/删除）静默跳过——它不是反解失败，不该进无法识别清单。
 */
export async function scanFolderForImport(opts?: {
  onProgress?: (resolved: number) => void;
}): Promise<ImportScanResult[]> {
  const dir = await ensureFolderPermission();
  if (!dir) throw new Error("文件夹未授权：先在上方选择并授权文件夹");
  const handles = await listRelativeFiles(dir);
  const out: ImportScanResult[] = [];
  for (const [i, entry] of handles.entries()) {
    try {
      const file = await entry.handle.getFile();
      out.push({ path: entry.path, size: file.size, lastModified: file.lastModified });
    } catch {
      /* 文件消失：跳过 */
    }
    opts?.onProgress?.(i + 1);
  }
  return out;
}

/**
 * 已在匣 key 集：本地 listVault ∪ listServerVault（纸匣页 refresh 的合并口径）。
 * 两端都是 best-effort：本地拉不到不阻塞（空集只影响跳过计数），远端不可达退本地。
 */
export async function collectExistingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    for (const item of await listVault()) keys.add(item.key);
  } catch {
    /* 本地目录拉不到：当空集继续 */
  }
  const remote = await listServerVault();
  if (remote) {
    for (const item of remote.items) keys.add(item.key);
  }
  return keys;
}

export type ImportExecution = {
  imported: number;
  /** 服务端目录上报失败数（best-effort，不阻断；删除链需要服务端行才能软删）。 */
  serverFailed: number;
  /** 本地写入抛错被收集的条数（纯增量，整体重跑按 key 幂等补齐）。 */
  failed: number;
};

/**
 * 执行导入计划：逐条 putVaultMeta + rememberVaultKey + pushVaultMetaToServer
 * best-effort，最后 vault-index refresh 一次。
 *
 * 用法：executeImportPlan(plan, { onProgress })；单条失败 try/catch 收集后继续。
 * 为什么按这个顺序：本地目录先落（离线也有），索引即时亮「已在纸匣」，服务端
 * 行最后补——失败只计数，纸匣页重挂载时 refresh 会带正目录。
 */
export async function executeImportPlan(
  plan: ImportPlan,
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<ImportExecution> {
  let imported = 0;
  let serverFailed = 0;
  let failed = 0;
  const total = plan.records.length;
  let done = 0;
  for (const record of plan.records) {
    try {
      await putVaultMeta(record.meta);
      rememberVaultKey(record.meta.source, record.meta.id);
      const pushed = await pushVaultMetaToServer(record.meta);
      if (!pushed) serverFailed += 1;
      imported += 1;
    } catch {
      failed += 1;
    }
    done += 1;
    opts?.onProgress?.(done, total);
  }
  // rememberVaultKey 已逐条增量回填浏览侧；refresh 再对一次服务端目录（异步，
  // 不阻塞完成汇报）
  void useVaultIndex.getState().refresh();
  return { imported, serverFailed, failed };
}
