/**
 * theme-pack 服务端测试（临时 KAMI_ROOT + node:test）。
 *
 * 作用：锁扫描/降级/模板材料化/zip 路径/资产白名单（防穿越、未声明、超限）、
 *      导出落盘（安全名、撞名后缀、坏 manifest 拒）。
 * 环境注意：KAMI_ROOT 指到 mkdtemp 临时目录必须在 import 主题包服务端**之前**。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { zipSync } from "fflate";

const ROOT = mkdtempSync(join(tmpdir(), "kami-themes-test-"));
process.env.KAMI_ROOT = ROOT;

const server = await import("./theme-pack.server.ts");
const { scanThemePacks, readThemeAsset, exportThemePack, themesDir } = server;

function writePack(name: string, manifest: unknown, files: Record<string, string> = {}) {
  const dir = join(themesDir(), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "kami-theme.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    "utf8",
  );
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return dir;
}

const GOOD_MANIFEST = {
  kamitheme: 1,
  meta: { name: "夜航", author: "纸工", version: "1.0" },
  palette: { base: "washi", overrides: { accent: "#d8c9a8" } },
  shell: { form: "rail", tweaks: { iconSize: "lg" } },
};

before(() => {
  // 首扫触发 _template 材料化
  scanThemePacks(true);
});

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("scanThemePacks（扫描 / 降级 / 模板）", () => {
  it("空目录 → 零包；_template 自材料化且不出现在列表", () => {
    const r = scanThemePacks(true);
    assert.equal(r.packs.length, 0);
    assert.ok(existsSync(join(themesDir(), "_template", "kami-theme.json")));
    assert.ok(existsSync(join(themesDir(), "_template", "agent-prompt.md")));
  });

  it("好文件夹包（带 css）→ ok；css 缺失的包 → degraded 且给原因", () => {
    writePack("yehang", { ...GOOD_MANIFEST, css: "theme.css" }, { "theme.css": "a{color:var(--color-accent)}" });
    writePack("nocss", { ...GOOD_MANIFEST, meta: { name: "无样式" }, css: "theme.css" }, {});
    const r = scanThemePacks(true);
    const ok = r.packs.find((p) => p.id === "yehang");
    assert.equal(ok?.status, "ok");
    assert.match(ok?.css ?? "", /--color-accent/);
    const degraded = r.packs.find((p) => p.id === "nocss");
    assert.equal(degraded?.status, "degraded");
    assert.match(degraded?.dropped.join("|"), /css 文件缺失/);
  });

  it("坏包（JSON 烂 / 版本不认）不列出、计入 broken；_ 前缀跳过", () => {
    writePack("broken1", "{ not json");
    writePack("broken2", { kamitheme: 99, meta: { name: "x" } });
    writePack("_draft", GOOD_MANIFEST);
    const r = scanThemePacks(true);
    assert.ok(!r.packs.some((p) => p.id === "broken1" || p.id === "broken2" || p.id === "_draft"));
    assert.ok(r.broken >= 2);
  });

  it("zip 包也认（fflate 造夹具）；同茎文件夹+zip 并存时文件夹赢、zip 记坏", () => {
    // zipSync 只吃 Uint8Array（字符串会触发 fltn 递归爆栈），先编码
    const enc = new TextEncoder();
    const toZip = (o: Record<string, string>) =>
      Buffer.from(zipSync(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc.encode(v)]))));
    const files = {
      "kami-theme.json": JSON.stringify({ ...GOOD_MANIFEST, meta: { name: "打包夜航" } }),
      "theme.css": "b{color:red}",
    };
    writeFileSync(join(themesDir(), "zipped.zip"), toZip(files));
    writePack("zipped", { ...GOOD_MANIFEST, meta: { name: "文件夹版" } });
    const r = scanThemePacks(true);
    const z = r.packs.find((p) => p.id === "zipped");
    assert.equal(z?.manifest.meta.name, "文件夹版", "同茎时文件夹赢");
    assert.ok(r.broken >= 1, "同名 zip 记坏不连坐");
    // 再造一个不撞名的纯 zip
    writeFileSync(join(themesDir(), "pure.zip"), toZip({ "kami-theme.json": JSON.stringify({ ...GOOD_MANIFEST, meta: { name: "纯压缩" } }) }));
    const r2 = scanThemePacks(true);
    assert.equal(r2.packs.find((p) => p.id === "pure")?.manifest.meta.name, "纯压缩");
  });
});

describe("readThemeAsset（白名单 / 防穿越 / 限额）", () => {
  before(() => {
    writePack("assets-pk", { ...GOOD_MANIFEST, meta: { name: "带素材" }, assets: [{ id: "tex", file: "assets/tex.png" }] }, { "assets/tex.png": "PNGDATA" });
    scanThemePacks(true);
  });

  it("声明的资产可读；未声明 / 穿越 / 绝对路径 / 坏扩展全拒", () => {
    const ok = readThemeAsset("assets-pk", "assets/tex.png");
    assert.ok(ok.ok);
    assert.equal(new TextDecoder().decode(ok.ok ? ok.bytes : new Uint8Array()), "PNGDATA");
    assert.equal(ok.ok ? ok.mime : "", "image/png");
    assert.equal(readThemeAsset("assets-pk", "../kami-theme.json").ok, false);
    assert.equal(readThemeAsset("assets-pk", "/abs.png").ok, false, "绝对路径拒");
    assert.equal(readThemeAsset("assets-pk", "C:/abs.png").ok, false, "盘符路径拒");
    assert.equal(readThemeAsset("assets-pk", "assets/undeclared.png").ok, false, "未声明的文件 403");
    assert.equal(readThemeAsset("assets-pk", "assets/tex.exe").ok, false);
    assert.equal(readThemeAsset("ghost", "assets/tex.png").ok, false);
  });

  it("zip 内滑梯路径：manifest 声明阶段就被路径白名单拒掉（assets 段丢、资产请求拒）", () => {
    const enc = new TextEncoder();
    const toZip = (o: Record<string, string>) =>
      Buffer.from(zipSync(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc.encode(v)]))));
    writeFileSync(
      join(themesDir(), "sneaky.zip"),
      toZip({ "kami-theme.json": JSON.stringify({ ...GOOD_MANIFEST, meta: { name: "滑梯" }, assets: [{ id: "evil", file: "../evil.png" }] }) }),
    );
    const r = scanThemePacks(true);
    const pack = r.packs.find((p) => p.id === "sneaky");
    assert.ok(pack, "包本体（合法部分）仍列出");
    assert.deepEqual(pack?.manifest.assets, undefined, "滑梯 asset 声明被丢");
    assert.equal(readThemeAsset("sneaky", "../evil.png").ok, false);
  });
});

describe("exportThemePack（导出落盘）", () => {
  it("好 manifest → 安全名落盘可回扫；坏 manifest 拒；撞名加后缀", () => {
    const r = exportThemePack({ ...GOOD_MANIFEST, meta: { name: "我的 夜/航:特别版" } });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.id, "我的-夜-航-特别版");
    assert.ok(existsSync(join(r.dir, "kami-theme.json")));
    const r2 = exportThemePack({ ...GOOD_MANIFEST, meta: { name: "我的 夜/航:特别版" } });
    assert.ok(r2.ok);
    if (r2.ok) assert.equal(r2.id, "我的-夜-航-特别版-2");
    assert.equal(exportThemePack({ kamitheme: 2 }).ok, false);
    const scanned = scanThemePacks(true);
    assert.ok(scanned.packs.some((p) => p.id === "我的-夜-航-特别版"));
    const written = JSON.parse(readFileSync(join(themesDir(), "我的-夜-航-特别版", "kami-theme.json"), "utf8")) as { kamitheme: number };
    assert.equal(written.kamitheme, 1);
  });
});

describe("符号链接越界（安全批 R1）", () => {
  const canSymlink = (() => {
    try {
      const probe = join(ROOT, "symprobe");
      writeFileSync(probe, "x", "utf8");
      const link = join(ROOT, "symprobe-link");
      try {
        symlinkSync(probe, link);
        return existsSync(link);
      } finally {
        rmSync(link, { force: true });
        rmSync(probe, { force: true });
      }
    } catch {
      return false;
    }
  })();

  it("包外密件 + 包内符号链接资产 → 资产路由拒读不回字节", { skip: !canSymlink && "此环境无符号链接权限（CI ubuntu 覆盖）" }, () => {
    const secretPath = join(ROOT, "secret-outside.png");
    writeFileSync(secretPath, "SECRETPNG", "utf8");
    const dir = writePack("link-asset", { ...GOOD_MANIFEST, meta: { name: "链资产" }, assets: [{ id: "tex", file: "assets/tex.png" }] }, {});
    mkdirSync(join(dir, "assets"), { recursive: true });
    symlinkSync(secretPath, join(dir, "assets", "tex.png"));
    scanThemePacks(true);
    const r = readThemeAsset("link-asset", "assets/tex.png");
    assert.equal(r.ok, false, "符号链接指向包外必须拒");
    if (r.ok) return;
    assert.ok(r.status === 404 || r.status === 400 || r.status === 403);
  });

  it("css 经符号链接指向包外密件 → 包降级且内容不随列表外泄", { skip: !canSymlink && "此环境无符号链接权限（CI ubuntu 覆盖）" }, () => {
    const secretCss = join(ROOT, "secret.css");
    writeFileSync(secretCss, "SECRET-TOKEN{color:red}", "utf8");
    const dir = writePack("link-css", { ...GOOD_MANIFEST, meta: { name: "链样式" }, css: "theme.css" }, {});
    symlinkSync(secretCss, join(dir, "theme.css"));
    const r = scanThemePacks(true);
    const pack = r.packs.find((p) => p.id === "link-css");
    assert.ok(pack, "包本体（manifest 合法）仍列出");
    assert.equal(pack?.css, null, "链接 css 不外泄");
    assert.match(pack?.dropped.join("|") ?? "", /css 文件缺失/);
    assert.ok(!JSON.stringify(r).includes("SECRET-TOKEN"), "列表载荷不得含密件内容");
  });

  it("包目录本身是链接：按真实路径界内读取（用户自挂目录等同直放，行为锁定）", { skip: !canSymlink && "此环境无符号链接权限（CI ubuntu 覆盖）" }, () => {
    const real = join(ROOT, "real-pack-outside");
    rmSync(real, { recursive: true, force: true });
    mkdirSync(real, { recursive: true });
    writeFileSync(
      join(real, "kami-theme.json"),
      JSON.stringify({ ...GOOD_MANIFEST, meta: { name: "目录链接" }, assets: [{ id: "tex", file: "tex.png" }] }),
      "utf8",
    );
    writeFileSync(join(real, "tex.png"), "PNG", "utf8");
    symlinkSync(real, join(themesDir(), "link-dir"));
    const r = scanThemePacks(true);
    assert.ok(r.packs.some((p) => p.id === "link-dir"), "目录链接包照常列出");
    const a = readThemeAsset("link-dir", "tex.png");
    assert.ok(a.ok, "界内声明资产可读（realpath 归一到真实根后 containment 成立）");
  });
});

describe("ZIP 前置限额（安全批 R2）", () => {
  it("解压量超 32MB 的炸弹在 filter 阶段拒绝，不进内存、整包记坏", () => {
    const enc = new TextEncoder();
    const toZip = (o: Record<string, Uint8Array>) => Buffer.from(zipSync(o));
    writeFileSync(
      join(themesDir(), "bomb.zip"),
      toZip({
        "kami-theme.json": enc.encode(JSON.stringify({ ...GOOD_MANIFEST, meta: { name: "炸弹" } })),
        "big.bin": new Uint8Array(40 * 1024 * 1024),
      }),
    );
    const t0 = Date.now();
    const r = scanThemePacks(true);
    assert.ok(!r.packs.some((p) => p.id === "bomb"), "炸弹包不列出");
    assert.ok(r.broken >= 1, "计入 broken");
    assert.ok(Date.now() - t0 < 5_000, "无需解压即拒（快速返回）");
  });

  it("单条目 1.5MB 的大包行为不变（健壮二批起单条目上限 2MB，旧 20MB 夹具随新规失效）", () => {
    const enc = new TextEncoder();
    const toZip = (o: Record<string, Uint8Array>) => Buffer.from(zipSync(o));
    writeFileSync(
      join(themesDir(), "big-ok.zip"),
      toZip({
        "kami-theme.json": enc.encode(JSON.stringify({ ...GOOD_MANIFEST, meta: { name: "大而合法" } })),
        "pad.bin": new Uint8Array(1536 * 1024),
      }),
    );
    const r = scanThemePacks(true);
    assert.equal(r.packs.find((p) => p.id === "big-ok")?.manifest.meta.name, "大而合法");
  });
});

describe("读取预检与 zip 约束（健壮二批 R1/R2）", () => {
  it("3MB 文件夹资产在 statSync 阶段拒读；扫描不受影响", () => {
    const dir = writePack("fat-asset", { ...GOOD_MANIFEST, meta: { name: "胖资产" }, assets: [{ id: "big", file: "big.png" }] }, {});
    writeFileSync(join(dir, "big.png"), Buffer.alloc(3 * 1024 * 1024, 1));
    const scan = scanThemePacks(true);
    assert.ok(scan.packs.some((p) => p.id === "fat-asset"), "包本体（manifest 合法）仍列出");
    assert.equal(readThemeAsset("fat-asset", "big.png").ok, false, "超大资产预检拒");
  });

  it("130KB css 预检拒（css 段缺失降级）；70KB css 仍由 sanitize 报真实 64KB 上限", () => {
    const fatDir = writePack("fat-css", { ...GOOD_MANIFEST, meta: { name: "胖样式" }, css: "theme.css" }, {});
    writeFileSync(join(fatDir, "theme.css"), "html[data-kami-theme] .a{x:1}\n".repeat(7000), "utf8");
    const midDir = writePack("mid-css", { ...GOOD_MANIFEST, meta: { name: "中样式" }, css: "theme.css" }, {});
    writeFileSync(join(midDir, "theme.css"), `html[data-kami-theme] .a{content:"${"a".repeat(70_000)}"}`, "utf8");
    const scan = scanThemePacks(true);
    const fat = scan.packs.find((p) => p.id === "fat-css");
    assert.equal(fat?.css, null, "130KB 预检拒");
    assert.match(fat?.dropped.join("|") ?? "", /css 文件缺失/);
    const mid = scan.packs.find((p) => p.id === "mid-css");
    assert.equal(mid?.css, null, "70KB 交给 sanitize");
    assert.match(mid?.dropped.join("|") ?? "", /超过 64KB/, "真实上限原因透出");
  });

  it("超大 manifest（>256KB）整包判坏不进内存", () => {
    writePack("fat-manifest", { ...GOOD_MANIFEST, meta: { name: "胖清单" } }, {});
    writeFileSync(join(themesDir(), "fat-manifest", "kami-theme.json"), Buffer.alloc(300 * 1024, 32), "utf8");
    const scan = scanThemePacks(true);
    assert.ok(!scan.packs.some((p) => p.id === "fat-manifest"), "不列出");
    assert.ok(scan.broken >= 1);
  });

  it("盘上 70MB zip 判坏不读取；600 空条目 zip 判坏；3MB 单条目 zip 判坏", () => {
    writeFileSync(join(themesDir(), "disk-fat.zip"), Buffer.alloc(70 * 1024 * 1024, 0));
    const enc = new TextEncoder();
    const toZip = (o: Record<string, Uint8Array>) => Buffer.from(zipSync(o));
    const many: Record<string, Uint8Array> = { "kami-theme.json": enc.encode("{}") };
    for (let i = 0; i < 600; i += 1) many[`e${i}`] = enc.encode("");
    writeFileSync(join(themesDir(), "many-entries.zip"), toZip(many));
    writeFileSync(
      join(themesDir(), "fat-entry.zip"),
      toZip({ "kami-theme.json": enc.encode(JSON.stringify(GOOD_MANIFEST)), "big.bin": new Uint8Array(3 * 1024 * 1024) }),
    );
    const scan = scanThemePacks(true);
    for (const id of ["disk-fat", "many-entries", "fat-entry"]) {
      assert.ok(!scan.packs.some((p) => p.id === id), `${id} 不列出`);
    }
    assert.ok(scan.broken >= 3);
  });
});

describe("伪造 ZIP 头部（复核 P1：不能只信声明尺寸）", () => {
  /** 把 zip 中心目录里首个非常规条目的 uncompressed/compressed 声明改小（真实内容远大）。 */
  function shrinkDeclaredSizes(zip: Buffer, entryName: string): Buffer {
    const out = Buffer.from(zip);
    // EOCD：从尾部找 0x06054b50
    let e = out.length - 22;
    while (e > 0 && out.readUInt32LE(e) !== 0x06054b50) e -= 1;
    assert.ok(e > 0, "EOCD 没找到");
    const count = out.readUInt16LE(e + 10);
    let p = out.readUInt32LE(e + 16);
    for (let i = 0; i < count; i += 1) {
      assert.equal(out.readUInt32LE(p), 0x02014b50, "中心目录签名");
      const nameLen = out.readUInt16LE(p + 28);
      const name = out.subarray(p + 46, p + 46 + nameLen).toString("latin1");
      if (name === entryName) {
        out.writeUInt32LE(1024, p + 20); // 声明 compressed = 1KB
        out.writeUInt32LE(1024, p + 24); // 声明 uncompressed = 1KB
        return out;
      }
      p += 46 + nameLen + out.readUInt16LE(p + 30) + out.readUInt16LE(p + 32);
    }
    throw new Error(`条目 ${entryName} 没找到`);
  }

  it("声明 1KB / 实际 3MB 的伪头部条目：扫描快速返回且包判坏，无内存放大", () => {
    const enc = new TextEncoder();
    const real = new Uint8Array(3 * 1024 * 1024); // 全零：压缩后极小、解压 3MB
    const honest = Buffer.from(
      zipSync({ "kami-theme.json": enc.encode(JSON.stringify(GOOD_MANIFEST)), "pad.bin": real }),
    );
    writeFileSync(join(themesDir(), "lying.zip"), shrinkDeclaredSizes(honest, "pad.bin"));
    const t0 = Date.now();
    const r = scanThemePacks(true);
    const ms = Date.now() - t0;
    assert.ok(!r.packs.some((p) => p.id === "lying"), "伪头部包不列出（manifest 经截断/错位必然解析失败）");
    assert.ok(r.broken >= 1);
    assert.ok(ms < 5_000, `快速返回（实测 ${ms}ms）——预置 out 不扩容 + 声明压缩尺寸钉死，无放大面`);
  });

  it("声明压缩尺寸超 2MB 的条目在 filter 阶段拒（不进解码）", () => {
    const enc = new TextEncoder();
    const toZip = (o: Record<string, Uint8Array>) => Buffer.from(zipSync(o));
    const honest = toZip({ "kami-theme.json": enc.encode(JSON.stringify(GOOD_MANIFEST)), "pad.bin": new Uint8Array(1536 * 1024) });
    writeFileSync(join(themesDir(), "fat-sc.zip"), shrinkDeclaredSizes(honest, "pad.bin"));
    // honest pad 1.5MB 存储块压缩后 ≈1.5MB > 2MB？零数据 deflate 会很小——改用随机不可压数据逼出大压缩尺寸
    const rnd = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < rnd.length; i += 1) rnd[i] = (i * 7 + 13) & 0xff;
    const honestBig = toZip({ "kami-theme.json": enc.encode(JSON.stringify(GOOD_MANIFEST)), "rnd.bin": rnd });
    writeFileSync(join(themesDir(), "fat-sc.zip"), honestBig); // 真实压缩尺寸 ≈3MB（不可压）
    const r = scanThemePacks(true);
    assert.ok(!r.packs.some((p) => p.id === "fat-sc"), "声明压缩尺寸 >2MB 拒");
    assert.ok(r.broken >= 1);
  });
});
