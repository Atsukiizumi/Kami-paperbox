/**
 * desk-layout 纯函数测试（node:test 表驱动）。
 *
 * 作用：锁槽模型清洗口径——未知模块丢弃、span 钳位、空槽剪枝、重复上场去重、
 *      全下场回默认；版式清单的内置保护/去重/上限；外壳形态枚举与旋钮白名单
 *      （越权键消失）；页参数越界回 medium。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DESK_LAYOUT,
  DESK_DEFAULT_PRESET_ID,
  DESK_PRESET_LIMIT,
  parseDeskLayout,
  parseDeskPresets,
  parsePageLayout,
  parseShell,
  reflowDeskLayout,
} from "./desk-layout.ts";

describe("parseDeskLayout（槽模型清洗）", () => {
  it("合法布局原样通过（默认稿纸往返）", () => {
    assert.deepEqual(parseDeskLayout(DEFAULT_DESK_LAYOUT), DEFAULT_DESK_LAYOUT);
  });

  it("未知模块丢弃；span 越界钳到 1；空槽剪枝", () => {
    const out = parseDeskLayout({
      slots: [
        { span: 2, items: ["browse-sheet"] },
        { span: 9, items: ["newspaper", "ghost-module"] },
        { span: 1, items: [] },
        { span: 3, items: [null, 42] },
      ],
      headerSlip: true,
    });
    assert.deepEqual(out.slots, [
      { span: 2, items: ["browse-sheet"] },
      { span: 1, items: ["newspaper"] },
    ]);
  });

  it("同一模块重复上场只保留首个位置", () => {
    const out = parseDeskLayout({
      slots: [
        { span: 1, items: ["newspaper"] },
        { span: 1, items: ["newspaper", "letters"] },
      ],
    });
    assert.deepEqual(out.slots, [
      { span: 1, items: ["newspaper"] },
      { span: 1, items: ["letters"] },
    ]);
  });

  it("五件套全下场回默认槽，但 headerSlip 尊重用户关闭", () => {
    const out = parseDeskLayout({ slots: [], headerSlip: false });
    assert.deepEqual(out.slots, DEFAULT_DESK_LAYOUT.slots);
    assert.equal(out.headerSlip, false);
    assert.equal(parseDeskLayout(null).headerSlip, true);
  });
});

describe("parseDeskPresets（版式清单）", () => {
  it("内置稿纸永远在场且排第一；垃圾行跳过", () => {
    const { presets, activePresetId } = parseDeskPresets({
      presets: [{ id: "", name: "无名" }, { id: "p1", name: "夜读", layout: { slots: [] } }, "junk"],
      activePresetId: "p1",
    });
    assert.equal(presets[0]?.id, DESK_DEFAULT_PRESET_ID);
    assert.ok(presets[0]?.builtIn);
    assert.equal(presets.length, 2);
    assert.equal(presets[1]?.name, "夜读");
    assert.equal(activePresetId, "p1");
  });

  it("重名 id 去重；用户版式超上限截断", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `版式${i}` }));
    const dup = [...many, { id: "p1", name: "重复" }];
    const { presets } = parseDeskPresets({ presets: dup });
    assert.equal(presets.length, DESK_PRESET_LIMIT + 1);
    assert.equal(new Set(presets.map((p) => p.id)).size, presets.length);
  });

  it("激活指针指向不存在的版式时回稿纸", () => {
    const { activePresetId } = parseDeskPresets({ presets: [], activePresetId: "ghost" });
    assert.equal(activePresetId, DESK_DEFAULT_PRESET_ID);
  });
});

describe("parseShell（外壳形态+旋钮白名单）", () => {
  it("非法形态回 desk 且旋钮清空", () => {
    assert.deepEqual(parseShell({ form: " cockpit ", tweaks: { contentWidth: "wide" } }), { form: "desk", tweaks: {} });
  });

  it("desk 只认 contentWidth/topbarDensity；rail 认 iconSize/topbar；zen 认 triggerSide", () => {
    const all = { contentWidth: "wide", topbarDensity: "compact", iconSize: "lg", topbar: "float", contentMargin: "tight", triggerSide: "right" };
    assert.deepEqual(parseShell({ form: "desk", tweaks: all }).tweaks, { contentWidth: "wide", topbarDensity: "compact" });
    assert.deepEqual(parseShell({ form: "rail", tweaks: all }).tweaks, { contentWidth: "wide", iconSize: "lg", topbar: "float" });
    assert.deepEqual(parseShell({ form: "zen", tweaks: all }).tweaks, { contentMargin: "tight", triggerSide: "right" });
  });

  it("旋钮取值越界丢弃", () => {
    const out = parseShell({ form: "rail", tweaks: { iconSize: "xl", topbar: "float" } });
    assert.deepEqual(out.tweaks, { topbar: "float" });
  });
});

describe("parsePageLayout（页参数）", () => {
  it("越界值回 medium（= 现状）", () => {
    assert.deepEqual(parsePageLayout({ density: "spacy", vaultCol: 3 }), { density: "medium", vaultCol: "medium" });
    assert.deepEqual(parsePageLayout({ density: "tight", vaultCol: "wide" }), { density: "tight", vaultCol: "wide" });
  });
});

describe("reflowDeskLayout（渲染期空槽让位）", () => {
  it("右栏三件套全不可用 → 槽抽掉 + 铺纸提满宽（复刻旧 asideEmpty）", () => {
    const onlyAlways = new Set(["browse-sheet", "newspaper"] as const);
    const out = reflowDeskLayout(DEFAULT_DESK_LAYOUT.slots, onlyAlways);
    assert.deepEqual(out, [
      { span: 3, items: ["browse-sheet"] },
      { span: 3, items: ["newspaper"] },
    ]);
  });

  it("部分可用时只抽空槽，不提宽、不动原数组", () => {
    const avail = new Set(["browse-sheet", "newspaper", "stack"] as const);
    const slots = DEFAULT_DESK_LAYOUT.slots.map((s) => ({ ...s }));
    const out = reflowDeskLayout(slots, avail);
    assert.deepEqual(out, [
      { span: 2, items: ["browse-sheet"] },
      { span: 1, items: ["stack"] },
      { span: 3, items: ["newspaper"] },
    ]);
    assert.equal(slots[1]!.items.length, 3, "原数组不被改动");
  });

  it("全可用时原样返回；用户存下的两槽版式不被提满宽", () => {
    const all = new Set(["browse-sheet", "newspaper", "letters", "stack", "artist-wall"] as const);
    assert.deepEqual(reflowDeskLayout(DEFAULT_DESK_LAYOUT.slots, all), DEFAULT_DESK_LAYOUT.slots);
    // 用户把右栏三件套全下场后存档：只剩 [span2 铺纸][span3 报纸]——合法版式，
    // 渲染期不得因为形状凑巧而偷偷提满宽。
    const userLayout = [
      { span: 2 as const, items: ["browse-sheet" as const] },
      { span: 3 as const, items: ["newspaper" as const] },
    ];
    assert.deepEqual(reflowDeskLayout(userLayout, all), userLayout);
    // 但同样形状若是「中间槽被可用性抽掉」的产物，仍要提满宽复刻旧 asideEmpty
    const withoutLetters = new Set(["browse-sheet", "newspaper", "stack", "artist-wall"] as const);
    const withDropped = [
      { span: 2 as const, items: ["browse-sheet" as const] },
      { span: 1 as const, items: ["letters" as const] },
      { span: 3 as const, items: ["newspaper" as const] },
    ];
    assert.deepEqual(reflowDeskLayout(withDropped, withoutLetters), [
      { span: 3, items: ["browse-sheet"] },
      { span: 3, items: ["newspaper"] },
    ]);
  });
});
