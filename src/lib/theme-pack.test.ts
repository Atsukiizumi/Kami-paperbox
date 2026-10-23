/**
 * theme-pack 纯函数测试（node:test 表驱动）。
 *
 * 作用：锁 manifest 解析矩阵（整包拒/段级降级）、CSS 清洗口径（@import 拒、
 *      url 白名单重写、data: 上限、64KB 上限）、导出组装与目录名清洗。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeExportManifest,
  isSafePackPath,
  parseThemeManifest,
  safeThemeDirName,
  sanitizeThemeCss,
  uniquifyThemeDirName,
} from "./theme-pack.ts";
import { DEFAULT_DESK_LAYOUT, DEFAULT_SHELL } from "./desk-layout.ts";

const GOOD: Record<string, unknown> = {
  kamitheme: 1,
  meta: { name: "夜航", author: "纸工", version: "1.0" },
  palette: { base: "washi", overrides: { bg: "#101014", accent: "oklch(0.8 0.02 20)" } },
  shell: { form: "rail", tweaks: { iconSize: "lg" } },
  layout: DEFAULT_DESK_LAYOUT,
  css: "theme.css",
  assets: [{ id: "paper", file: "assets/tex.png" }],
  preview: "preview.png",
};

describe("parseThemeManifest（整包拒 / 段级降级）", () => {
  it("好包全段通过", () => {
    const r = parseThemeManifest(GOOD);
    assert.ok(r.ok);
    assert.deepEqual(r.dropped, []);
    assert.equal(r.manifest.meta.name, "夜航");
    assert.equal(r.manifest.shell?.form, "rail");
    assert.equal(r.manifest.assets?.length, 1);
  });

  it("版本不认 / 非对象 / 缺名 → 整包拒", () => {
    assert.equal(parseThemeManifest({ ...GOOD, kamitheme: 2 }).ok, false);
    assert.equal(parseThemeManifest("junk").ok, false);
    assert.equal(parseThemeManifest({ ...GOOD, meta: { author: "无名氏" } }).ok, false);
  });

  it("段级脏值降级不连坐：非法形态丢 shell、坏色丢 overrides、坏路径丢 css/preview", () => {
    const r = parseThemeManifest({
      ...GOOD,
      shell: { form: "cockpit", tweaks: { iconSize: "lg" } },
      palette: { base: "washi", overrides: { bg: "url(x)", accent: "#fff", bogus: "#111" } },
      css: "../escape.css",
      preview: "/abs.png",
      assets: [{ id: "bad id!", file: "a.png" }, { id: "ok1", file: "b.png" }],
    });
    assert.ok(r.ok);
    const dropped = r.dropped.join("|");
    assert.match(dropped, /shell/);
    assert.match(dropped, /css/);
    assert.match(dropped, /preview/);
    assert.equal(r.manifest.shell, undefined);
    // overrides 只留合法颜色键值；坏键全丢
    assert.deepEqual(r.manifest.palette?.overrides, { accent: "#fff" });
    // assets 坏条目丢、好条目留
    assert.deepEqual(r.manifest.assets, [{ id: "ok1", file: "b.png" }]);
  });

  it("palette base 非内置主题 → 丢 base 记原因，overrides 保留", () => {
    const r = parseThemeManifest({ ...GOOD, palette: { base: "neon-city", overrides: { fg: "#eee" } } });
    assert.ok(r.ok);
    assert.equal(r.manifest.palette?.base, undefined);
    assert.deepEqual(r.manifest.palette?.overrides, { fg: "#eee" });
  });
});

describe("sanitizeThemeCss", () => {
  const assets = [{ id: "paper", file: "assets/tex.png" }, { id: "font", file: "assets/kami.woff2" }];

  it("声明的资产 url 重写为本站资产路由；未声明的换成 none（可继续）", () => {
    const css = 'html[data-kami-theme] .bg{background:url("assets/tex.png")} html[data-kami-theme] .a{src:url(assets/kami.woff2) format("woff2")} html[data-kami-theme] .b{background:url(https://evil.example/x.png)}';
    const r = sanitizeThemeCss(css, "yèháng", assets);
    assert.ok(r.css);
    assert.match(r.css, /url\("\/api\/themes\/asset\?theme=y%C3%A8h%C3%A1ng&file=assets%2Ftex\.png"\)/);
    assert.match(r.css, /url\("\/api\/themes\/asset\?theme=y%C3%A8h%C3%A1ng&file=assets%2Fkami\.woff2"\)/);
    assert.match(r.css, /background:\s*none/);
    assert.match(r.reason ?? "", /url/);
  });

  it("小型 data: 位图放行；超限 data: 换 none", () => {
    const small = "data:image/png;base64," + "A".repeat(64);
    const big = "data:image/png;base64," + "A".repeat(9 * 1024);
    const r = sanitizeThemeCss(`.a{background:url("${small}")}.b{background:url("${big}")}`, "t", []);
    assert.ok(r.css);
    assert.match(r.css!, /A{64}/);
    assert.match(r.css!, /\.b\{background:none\}/);
  });

  it("@import / expression / javascript: / image-set / 裸全局选择器 整段拒；超 64KB 拒", () => {
    assert.equal(sanitizeThemeCss("@import url(x);", "t", []).css, null);
    assert.equal(sanitizeThemeCss("a{background:expression(alert(1))}", "t", []).css, null);
    assert.equal(sanitizeThemeCss("a{background:url(javascript:1)}", "t", []).css, null);
    assert.equal(sanitizeThemeCss('a{background:image-set("https://evil.example/x.png" 1x)}', "t", []).css, null, "image-set 字符串形式可绕 url 白名单外呼，拒");
    assert.equal(sanitizeThemeCss("a{x:1}".repeat(20_000), "t", []).css, null);
    // 未裹作用域的全局选择器拒；裹了 html[data-kami-theme] 的放行
    assert.equal(sanitizeThemeCss("body{margin:0}", "t", []).css, null, "裸 body 拒");
    assert.equal(sanitizeThemeCss("html{--x:1}", "t", []).css, null, "裸 html 拒");
    assert.equal(sanitizeThemeCss(":root{--x:1}", "t", []).css, null, ":root 拒");
    assert.equal(sanitizeThemeCss("*{box-sizing:border-box}", "t", []).css, null, "裸 * 拒");
    const scoped = sanitizeThemeCss('html[data-kami-theme] body{margin:0} html[data-kami-theme] .a{color:red}', "t", []);
    assert.ok(scoped.css, "裹作用域的全局组合选择器放行");
  });

  it("layout 段脏值丢段记原因（不静默回出厂默认）", () => {
    const r1 = parseThemeManifest({ ...GOOD, layout: "nonsense" });
    assert.ok(r1.ok);
    assert.equal(r1.manifest.layout, undefined);
    assert.match(r1.dropped.join("|"), /layout/);
    const r2 = parseThemeManifest({ ...GOOD, layout: { slots: [] } });
    assert.ok(r2.ok);
    assert.equal(r2.manifest.layout, undefined, "空槽 layout 无意义 → 丢段");
    const r3 = parseThemeManifest({ ...GOOD, layout: { slots: [{ span: 2, items: ["ghost"] }] } });
    assert.ok(r3.ok);
    assert.equal(r3.manifest.layout, undefined, "槽内全是未知模块 → 丢段");
    const r4 = parseThemeManifest({ ...GOOD, layout: { slots: [{ span: 2, items: ["browse-sheet", "ghost"] }] } });
    assert.ok(r4.ok);
    assert.ok(r4.manifest.layout, "部分合法 → 清洗保留");
  });
});

describe("导出与目录名", () => {
  it("composeExportManifest：默认书案无旋钮时省掉 shell 段", () => {
    const m = composeExportManifest({ name: " 我的夜读 ", theme: "washi", shell: DEFAULT_SHELL, layout: DEFAULT_DESK_LAYOUT });
    assert.equal(m.meta.name, "我的夜读");
    assert.equal(m.meta.author, "Kami 纸匣导出");
    assert.equal(m.shell, undefined);
    assert.deepEqual(m.layout, DEFAULT_DESK_LAYOUT);
    const m2 = composeExportManifest({ name: "", theme: "aosumi", shell: { form: "rail", tweaks: {} }, layout: DEFAULT_DESK_LAYOUT });
    assert.equal(m2.meta.name, "我的主题");
    assert.equal(m2.shell?.form, "rail");
  });

  it("safeThemeDirName 清洗非法字符；纯点段/Windows 保留名回退；uniquify 撞名加后缀", () => {
    assert.equal(safeThemeDirName("夜航: 特别*版?"), "夜航-特别-版");
    assert.equal(safeThemeDirName("   "), "theme");
    assert.equal(safeThemeDirName("a/b\\c"), "a-b-c");
    assert.equal(safeThemeDirName(".."), "theme", "纯点段不得穿越");
    assert.equal(safeThemeDirName("..."), "theme");
    assert.equal(safeThemeDirName("CON"), "theme", "Windows 保留名回退");
    assert.equal(safeThemeDirName(".hidden"), "hidden");
    const existing = new Set(["夜航", "夜航-2"]);
    assert.equal(uniquifyThemeDirName("夜航", existing), "夜航-3");
    assert.equal(uniquifyThemeDirName("新装", existing), "新装");
  });

  it("isSafePackPath：拒绝对路径/..路径/反斜杠/超长", () => {
    assert.equal(isSafePackPath("assets/tex.png"), true);
    assert.equal(isSafePackPath("/abs.png"), false);
    assert.equal(isSafePackPath("a/../b.png"), false);
    assert.equal(isSafePackPath("a\\b.png"), false);
    assert.equal(isSafePackPath("a/" .repeat(60) + "x.png"), false);
  });
});
