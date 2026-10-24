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
  normalizeCssEscapes,
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

describe("normalizeCssEscapes（转义归一化）", () => {
  it("十六进制转义（含尾随空白消耗）与字面转义解码为明文", () => {
    assert.equal(normalizeCssEscapes("u\\72l(x)"), "url(x)", "\\72 后随字母即结束十六进制");
    assert.equal(normalizeCssEscapes("u\\72 l(x)"), "url(x)", "尾随空格被消耗");
    assert.equal(normalizeCssEscapes("\\@imp\\6frt"), "@import", "字面转义 + 无空格十六进制拼接");
    assert.equal(normalizeCssEscapes("imag\\65-set("), "image-set(", "\\e 本就是十六进制转义 U+000E——真绕过向量要写 \\65");
    assert.equal(normalizeCssEscapes("\\43 SS"), "CSS", "\\43 + 空格消耗");
    assert.equal(normalizeCssEscapes("\\000043 SS"), "CSS", "6 位十六进制 + 空格消耗");
  });

  it("单遍解码语义与浏览器一致；续行消解；\\0 映射 U+FFFD；串尾孤立反斜杠保留", () => {
    assert.equal(normalizeCssEscapes("a\\\\72 b"), "a\\72 b", "\\\\ 还原字面反斜杠后 72 不再参与转义");
    assert.equal(normalizeCssEscapes("u\\\nrl(x)"), "url(x)", "反斜杠+换行=续行，两者皆消");
    assert.equal(normalizeCssEscapes("u\\\r\nrl(x)"), "url(x)", "CRLF 是一对续行符，整体消解");
    assert.equal(normalizeCssEscapes("\\0 x"), "\uFFFDx", "十六进制转义后的一个空白按规范消耗");
    assert.equal(normalizeCssEscapes("a\\"), "a\\", "串尾孤立反斜杠原样保留");
  });
});

describe("sanitizeThemeCss 转义绕过（R3）", () => {
  it("u\\72l( 外呼在归一化后被 url 白名单拦下（换 none，不外泄原 URL）", () => {
    const r = sanitizeThemeCss('html[data-kami-theme] .a{background:u\\72l(https://evil.example/x.png)}', "t", []);
    assert.ok(r.css);
    assert.ok(!r.css!.includes("evil.example"), "原 URL 不得残留");
    assert.match(r.css!, /background:\s*none/);
    assert.match(r.reason ?? "", /url/);
  });

  it("imag\\65-set( 与 \\@imp\\6frt 转义变体整段拒；字面 NUL 拒", () => {
    assert.equal(sanitizeThemeCss('html[data-kami-theme] .a{x:imag\\65-set("https://e/x" 1x)}', "t", []).css, null);
    assert.equal(sanitizeThemeCss('\\@imp\\6frt "x";', "t", []).css, null);
    assert.equal(sanitizeThemeCss("html[data-kami-theme] .a{x:1}\u0000", "t", []).css, null);
  });

  it("合法 css 内的常规转义（字体名字符串）不回归", () => {
    const r = sanitizeThemeCss('html[data-kami-theme] .f{font-family:"Foo\\ Bar",serif}', "t", []);
    assert.ok(r.css);
    assert.match(r.css!, /"Foo Bar"/);
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

describe("P3：主题包 custom 外壳段", () => {
  it("custom 形态过校验；宽度越界被钳制并记入 dropped（部分生效）", () => {
    const r = parseThemeManifest({
      ...GOOD,
      shell: { form: "custom", custom: { sidebar: { mode: "icons", width: 999, side: "right" }, topbar: { visible: false, density: "compact" }, content: { width: "full" } } },
    });
    assert.ok(r.ok);
    assert.equal(r.manifest.shell?.form, "custom");
    assert.equal(r.manifest.shell?.custom?.sidebar.width, 88, "icons 999 钳到 88");
    assert.equal(r.manifest.shell?.custom?.sidebar.side, "right");
    assert.match(r.dropped.join("|"), /999 钳制到 88/);
  });

  it("composeExportManifest：custom 设置原样带走（含 custom 段）", () => {
    const shell: import("./desk-layout.ts").ShellSettings = {
      form: "custom",
      tweaks: {},
      custom: {
        sidebar: { mode: "hidden", width: 0, side: "right" },
        topbar: { visible: false, density: "normal" },
        content: { width: "wide" },
      },
    };
    const m = composeExportManifest({ name: "右栏夜读", theme: "washi", shell, layout: DEFAULT_DESK_LAYOUT });
    assert.deepEqual(m.shell, shell);
  });

  it("旧口径兼容：非法形态（含旧版读不懂的 custom，由 parseShell 白名单兜底）跳段", () => {
    // 模拟旧版应用读 custom 包：parseShell 收到 form:"custom" 时旧 SHELL_FORMS 不含它 → 整段回 desk
    // （此处验证新版行为对照——form 合法即收，非法即跳）
    const r = parseThemeManifest({ ...GOOD, shell: { form: "cockpit" } });
    assert.ok(r.ok);
    assert.equal(r.manifest.shell, undefined);
    assert.match(r.dropped.join("|"), /shell/);
  });
});

describe("转义码点规范化（健壮二批 R3）", () => {
  it("\\FFFFFF / \\D800 超界码点回 U+FFFD（不再抛 RangeError）；\\10FFFF 保留真码点", () => {
    assert.equal(normalizeCssEscapes("\\FFFFFF x"), "\uFFFDx", "超 Unicode 上限（尾空白照常消耗）");
    assert.equal(normalizeCssEscapes("\\D800 x"), "\uFFFDx", "代理区下半");
    assert.equal(normalizeCssEscapes("\\DFFF x"), "\uFFFDx", "代理区上半");
    assert.equal(normalizeCssEscapes("\\10FFFF x"), "\u{10FFFF}x", "上限内保留");
  });

  it("含 \\FFFFFF 的整段 css 清洗不再抛异常（列表 500 修复）", () => {
    const r = sanitizeThemeCss('html[data-kami-theme] .a{content:"\\FFFFFF"}', "t", []);
    assert.ok(r.css, "清洗正常返回");
  });
});
