import assert from "node:assert/strict";
import { test } from "node:test";
import { PATH_PRESETS, templateForPreset } from "./download-path.ts";
import { parseImportPath, planFolderImport } from "./folder-import.ts";
import type { ImportScanResult } from "./folder-import.ts";

// 七预设逐一样例（design 2.1 逐条模拟的可执行版）：同一份 id=12345 / page=0 /
// title=无题 的文件名，按各预设的目录形态摆位后必须完整反解回来。
const PRESET_CASES: Record<
  string,
  { path: string; want: { source?: string; id: string; page?: number; title?: string; author?: string } }
> = {
  flat: { path: "12345_p0_无题.jpg", want: { id: "12345", page: 0, title: "无题" } },
  author: { path: "こいし/12345_p0_无题.jpg", want: { id: "12345", page: 0, title: "无题", author: "こいし" } },
  date: { path: "2026-08-31/12345_p0_无题.jpg", want: { id: "12345", page: 0, title: "无题" } },
  datetime: { path: "2026-08-31/160530_12345_p0_无题.jpg", want: { id: "12345", page: 0, title: "无题" } },
  "author-date": { path: "こいし/2026-08/12345_p0_无题.jpg", want: { id: "12345", page: 0, title: "无题", author: "こいし" } },
  "site-author": { path: "pixiv/こいし/12345_p0_无题.jpg", want: { source: "pixiv", id: "12345", page: 0, title: "无题", author: "こいし" } },
  custom: { path: "こいし/12345_p0_无题.jpg", want: { id: "12345", page: 0, title: "无题", author: "こいし" } },
};

for (const preset of PATH_PRESETS) {
  const kase = PRESET_CASES[preset.id];
  test(`parseImportPath 预设 ${preset.id}（${preset.label}）样例反解`, () => {
    assert.deepEqual(parseImportPath(kase.path, templateForPreset(preset.id)), {
      ok: true,
      source: kase.want.source,
      id: kase.want.id,
      page: kase.want.page,
      title: kase.want.title,
      author: kase.want.author,
    });
  });
}

test("parseImportPath datetime 的 {time}_{id} 切分：time 固定 6 位钉死起点，id 不吞时间", () => {
  const got = parseImportPath("2026-08-31/160530_12345_p0_无题.jpg", templateForPreset("datetime"));
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.id, "12345");
  assert.notEqual(got.id, "160530_12345");
  assert.equal(got.page, 0);
  assert.equal(got.title, "无题");
});

test("parseImportPath 标题含点与下划线不裂（贪婪 + ext 锚尾）", () => {
  const got = parseImportPath("12345_p0_report_p2_final.jpg", templateForPreset("flat"));
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.id, "12345");
  assert.equal(got.page, 0);
  assert.equal(got.title, "report_p2_final");
  const dotted = parseImportPath("12345_p0_a.b.c.jpg", templateForPreset("flat"));
  assert.equal(dotted.ok, true);
  if (!dotted.ok) return;
  assert.equal(dotted.title, "a.b.c");
});

test("parseImportPath 退化自定义模板（无标题 / {id} 收尾）照常可解", () => {
  const noTitle = parseImportPath("こいし/12345_p0.jpg", "{author}/{id}_p{page}.{ext}");
  assert.equal(noTitle.ok, true);
  if (!noTitle.ok) return;
  assert.equal(noTitle.author, "こいし");
  assert.equal(noTitle.page, 0);
  assert.equal(noTitle.title, undefined);
  // {id} 是最后 token：$ 锚强制吃满，非贪不歧义
  const idLast = parseImportPath("12345.jpg", "{id}.{ext}");
  assert.equal(idLast.ok, true);
  if (!idLast.ok) return;
  assert.equal(idLast.id, "12345");
});

test("parseImportPath {page1} 反解减一（含 0 捕获钳回第 0 页的边界）", () => {
  const template = "{author}/{id}_p{page1}_{title}.{ext}";
  for (const [captured, want] of [["1", 0], ["7", 6], ["0", 0]] as const) {
    const got = parseImportPath(`こいし/12345_p${captured}_无题.jpg`, template);
    assert.equal(got.ok, true, `page1=${captured}`);
    if (!got.ok) return;
    assert.equal(got.page, want, `page1=${captured} 应反解为第 ${want} 页`);
  }
});

test("parseImportPath {source} 大小写归一：Pixiv → pixiv", () => {
  const got = parseImportPath("Pixiv/こいし/12345_p0_无题.jpg", templateForPreset("site-author"));
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.source, "pixiv");
});

test("parseImportPath 未知站点归 unknown-source，且不被纯数字兜底救回", () => {
  assert.deepEqual(parseImportPath("moepedia/こいし/12345_p0_无题.jpg", templateForPreset("site-author")), {
    ok: false,
    reason: "unknown-source",
  });
});

test("parseImportPath 反斜杠路径归一（防御：正常流只有正斜杠）", () => {
  const got = parseImportPath("こいし\\12345_p0_无题.jpg", templateForPreset("author"));
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.author, "こいし");
  assert.equal(got.id, "12345");
});

test("parseImportPath 纯数字 basename 兜底（模板未中时）", () => {
  const template = templateForPreset("author");
  const bare = parseImportPath("12345.jpg", template);
  assert.deepEqual(bare, { ok: true, source: undefined, id: "12345", page: undefined, title: undefined, author: undefined });
  const paged = parseImportPath("12345_p0.png", template);
  assert.equal(paged.ok, true);
  if (!paged.ok) return;
  assert.equal(paged.page, 0);
  const titled = parseImportPath("12345_p0_无题.jpg", template);
  assert.equal(titled.ok, true);
  if (!titled.ok) return;
  assert.equal(titled.id, "12345");
  assert.equal(titled.page, 0);
  assert.equal(titled.title, undefined);
});

test("parseImportPath 两段式都没中归 no-match", () => {
  const template = templateForPreset("author");
  assert.deepEqual(parseImportPath("notes/readme.txt", template), { ok: false, reason: "no-match" });
  assert.deepEqual(parseImportPath("こいし/abc.jpg", template), { ok: false, reason: "no-match" });
});

// ── planFolderImport（design 2.1 计划形状 + 2.4 meta 字段表）────────────────

function scanFile(path: string, size: number, lastModified: number): ImportScanResult {
  return { path, size, lastModified };
}

test("planFolderImport 同 (source,id) 三文件合成一条：pageCount=3、页序、meta 字段按 2.4 表", () => {
  const plan = planFolderImport(
    [
      scanFile("12345_p2_无题.jpg", 300, 3000),
      scanFile("12345_p0_无题.jpg", 100, 1000),
      scanFile("12345_p1_无题.jpg", 200, 2000),
    ],
    templateForPreset("flat"),
    new Set(),
    { batchSource: "pixiv", folderLabel: "下载" },
  );
  assert.equal(plan.records.length, 1);
  assert.equal(plan.skippedInVault, 0);
  assert.deepEqual(plan.unrecognized, []);
  const { meta, files } = plan.records[0];
  assert.equal(meta.key, "pixiv:12345");
  assert.equal(meta.pageCount, 3);
  // ⚠ 高危点：savedAt 必须= page-0 文件的 lastModified（date/datetime 页路径重建 + 回忆流分月）
  assert.equal(meta.savedAt, 1000);
  assert.equal(meta.relativePath, "12345_p0_无题.jpg");
  assert.equal(meta.bytes, 600);
  assert.equal(meta.title, "无题");
  assert.equal(meta.author, "");
  assert.equal(meta.authorId, "");
  assert.deepEqual(meta.tags, []);
  assert.equal(meta.hasFile, false);
  assert.equal(meta.origin, "folder");
  assert.equal(meta.replaced, false);
  assert.equal(meta.folderLabel, "下载");
  assert.deepEqual(files.map((f) => f.path), ["12345_p0_无题.jpg", "12345_p1_无题.jpg", "12345_p2_无题.jpg"]);
});

test("planFolderImport 已在匣 key 整组跳过并计数", () => {
  const plan = planFolderImport(
    [
      scanFile("pixiv/こいし/12345_p0_无题.jpg", 100, 1000),
      scanFile("pixiv/こいし/999_p0_无题.jpg", 100, 1000),
    ],
    templateForPreset("site-author"),
    new Set(["pixiv:12345"]),
  );
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].meta.key, "pixiv:999");
  assert.equal(plan.skippedInVault, 1);
});

test("planFolderImport 无 {source} 模板且未选站点：匹配文件全进无法识别（缺站点类）", () => {
  const plan = planFolderImport(
    [scanFile("12345_p0_无题.jpg", 100, 1000)],
    templateForPreset("flat"),
    new Set(),
  );
  assert.equal(plan.records.length, 0);
  assert.equal(plan.skippedInVault, 0);
  assert.deepEqual(plan.unrecognized, ["12345_p0_无题.jpg"]);
});

test("planFolderImport 同页双扩展名去重，先见者留", () => {
  const plan = planFolderImport(
    [
      scanFile("12345_p0_无题.jpg", 100, 1000),
      scanFile("12345_p0_无题.png", 999, 9000),
      scanFile("12345_p1_无题.jpg", 200, 2000),
    ],
    templateForPreset("flat"),
    new Set(),
    { batchSource: "pixiv" },
  );
  assert.equal(plan.records.length, 1);
  const { meta, files } = plan.records[0];
  assert.equal(meta.pageCount, 2);
  assert.equal(meta.bytes, 300);
  assert.deepEqual(files.map((f) => f.path), ["12345_p0_无题.jpg", "12345_p1_无题.jpg"]);
});

test("planFolderImport 无页码模板每文件各成一条 pageCount=1", () => {
  const plan = planFolderImport(
    [scanFile("こいし/12345.jpg", 100, 1000), scanFile("こいし/12345.png", 200, 2000)],
    "{author}/{id}.{ext}",
    new Set(),
    { batchSource: "pixiv" },
  );
  assert.equal(plan.records.length, 2);
  for (const record of plan.records) {
    assert.equal(record.meta.pageCount, 1);
    assert.equal(record.meta.savedAt, record.files[0].lastModified);
  }
});

test("planFolderImport 反解失败与未知站点归无法识别清单", () => {
  const template = templateForPreset("site-author");
  const plan = planFolderImport(
    [
      scanFile("notes/readme.txt", 10, 10),
      scanFile("moepedia/こいし/12345_p0_无题.jpg", 100, 1000),
      scanFile("pixiv/こいし/777_p0_图.jpg", 100, 1000),
    ],
    template,
    new Set(),
  );
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].meta.key, "pixiv:777");
  assert.deepEqual(plan.unrecognized, ["notes/readme.txt", "moepedia/こいし/12345_p0_无题.jpg"]);
});

test("planFolderImport 多页缺 page-0：relativePath 留空、savedAt 回退当下（有限数即可）", () => {
  const plan = planFolderImport(
    [scanFile("12345_p1_无题.jpg", 200, 2000), scanFile("12345_p2_无题.jpg", 300, 3000)],
    templateForPreset("flat"),
    new Set(),
    { batchSource: "pixiv" },
  );
  const meta = plan.records[0].meta;
  assert.equal(meta.relativePath, undefined);
  assert.equal(Number.isFinite(meta.savedAt), true);
  assert.equal(meta.pageCount, 2);
});

test("planFolderImport 单文件记录该文件即代表页：relativePath/savedAt 落它", () => {
  const plan = planFolderImport(
    [scanFile("12345_p1_无题.jpg", 200, 2000)],
    templateForPreset("flat"),
    new Set(),
    { batchSource: "pixiv" },
  );
  const meta = plan.records[0].meta;
  assert.equal(meta.relativePath, "12345_p1_无题.jpg");
  assert.equal(meta.savedAt, 2000);
  assert.equal(meta.pageCount, 1);
});

// ── trellis-check P1 回归：混合组不再产出同 key 双记录 ─────────────────────

test("混合组（paged + 改名散文件兜底）：只立 paged 一条，散文件进无法识别；title 取模板命中", () => {
  const scan: ImportScanResult[] = [
    scanFile("こいし/12345_p0_無題.jpg", 1, 1000),
    scanFile("こいし/12345_p1_無題.jpg", 1, 1100),
    scanFile("こいし/12345.jpg", 1, 1200), // 改名散文件走纯数字兜底（无页码）
  ];
  const plan = planFolderImport(scan, "{author}/{id}_p{page}_{title}.{ext}", new Set(), {
    batchSource: "pixiv",
  });
  const keys = plan.records.map((r) => r.meta.key);
  assert.deepEqual(keys, ["pixiv:12345"], "同 key 只立一条（paged），散文件不再覆盖");
  assert.equal(plan.records[0]?.meta.pageCount, 2, "多页记录不被 pageCount=1 覆盖");
  assert.equal(plan.records[0]?.meta.relativePath, "こいし/12345_p0_無題.jpg");
  assert.equal(plan.records[0]?.meta.title, "無題", "组 title 取模板命中而非兜底散文件");
  assert.deepEqual(plan.unrecognized, ["こいし/12345.jpg"], "散文件进无法识别清单");
});
