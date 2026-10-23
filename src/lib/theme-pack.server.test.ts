/**
 * theme-pack 服务端测试（临时 KAMI_ROOT + node:test）。
 *
 * 作用：锁扫描/降级/模板材料化/zip 路径/资产白名单（防穿越、未声明、超限）、
 *      导出落盘（安全名、撞名后缀、坏 manifest 拒）。
 * 环境注意：KAMI_ROOT 指到 mkdtemp 临时目录必须在 import 主题包服务端**之前**。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
