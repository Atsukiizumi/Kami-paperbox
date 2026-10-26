import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BINDERY_DEFAULT_PRESET_ID,
  addBinderyPreset,
  cnDayChar,
  clampBinderyGrid,
  defaultBinderyDoc,
  gridColumns,
  gridLabel,
  loadBinderyDoc,
  moveTileBefore,
  normalizeBinderyData,
  parseBinderyDoc,
  removeBinderyPreset,
  saveBinderyDoc,
  swapByIndex,
  switchBinderyPreset,
} from "./bindery-hero.ts";

function withUserPreset() {
  const base = defaultBinderyDoc();
  const { doc } = addBinderyPreset(base, "追番", {
    grid: "feature",
    order: ["t2", "t1", "t3", "t4"],
    slips: { letters: true, stack: false, wall: true },
  });
  return doc;
}

describe("bindery-hero 版式架", () => {
  it("默认档：单一内置档且激活", () => {
    const doc = defaultBinderyDoc();
    assert.equal(doc.presets.length, 1);
    assert.equal(doc.activeId, BINDERY_DEFAULT_PRESET_ID);
    assert.equal(doc.presets[0].builtin, true);
  });

  it("切档：激活目标；未知 id 原样返回", () => {
    const doc = withUserPreset();
    const target = doc.presets[1].id;
    assert.equal(switchBinderyPreset(doc, target).activeId, target);
    assert.equal(switchBinderyPreset(doc, "no-such"), doc);
  });

  it("存为新档：追加并激活，名字去空白、空名兜底", () => {
    const { doc, id } = addBinderyPreset(defaultBinderyDoc(), "  日课 ", {
      grid: "duo",
      order: ["t1", "t2", "t3", "t4"],
      slips: { letters: true, stack: true, wall: true },
    });
    assert.equal(doc.presets[1].name, "日课");
    assert.equal(doc.activeId, id);
    const fallback = addBinderyPreset(defaultBinderyDoc(), "   ", doc.presets[0].data);
    assert.equal(fallback.doc.presets[1].name, "版式·1");
  });

  it("删档：内置拒删；删活跃档回落默认；删旁档不影响激活", () => {
    const doc = withUserPreset();
    const user = doc.presets[1].id;
    // 内置拒删
    assert.deepEqual(removeBinderyPreset(doc, BINDERY_DEFAULT_PRESET_ID), doc);
    // 删活跃的用户档 → 回落默认
    const fallen = removeBinderyPreset(doc, user);
    assert.equal(fallen.presets.length, 1);
    assert.equal(fallen.activeId, BINDERY_DEFAULT_PRESET_ID);
    // 删非活跃档（存档会激活新档，先切回用户档再删第三档）
    const two = switchBinderyPreset(addBinderyPreset(doc, "第二档", doc.presets[0].data).doc, user);
    const removed = removeBinderyPreset(two, two.presets[2].id);
    assert.equal(removed.activeId, user);
    assert.equal(removed.presets.length, 2);
  });
});

describe("bindery-hero 顺序运算", () => {
  it("moveTileBefore：拖拽摆位（移到目标前）", () => {
    assert.deepEqual(moveTileBefore(["t1", "t2", "t3", "t4"], "t1", "t3"), ["t2", "t1", "t3", "t4"]);
    assert.deepEqual(moveTileBefore(["t1", "t2"], "t9", "t1"), ["t1", "t2"]); // 未知 id 原样
    assert.deepEqual(moveTileBefore(["t1", "t2"], "t1", "t1"), ["t1", "t2"]);
  });

  it("swapByIndex：键盘搬移按位交换，越界原样", () => {
    assert.deepEqual(swapByIndex(["t1", "t2", "t3"], 0, 2), ["t3", "t2", "t1"]);
    assert.deepEqual(swapByIndex(["t1"], 0, 1), ["t1"]);
    assert.deepEqual(swapByIndex(["t1"], -1, 0), ["t1"]);
  });

  it("排格列数：四联 4 列，其余 2 列", () => {
    assert.equal(gridColumns("quad"), 4);
    assert.equal(gridColumns("duo"), 2);
    assert.equal(gridColumns("feature"), 2);
  });
});

describe("bindery-hero 数据收敛", () => {
  it("normalize：坏排格钳制、顺序去重补全、纸条开关兜底开", () => {
    const n = normalizeBinderyData({ grid: "banana", order: ["t3", "t3", "x", "t1"], slips: { stack: false } });
    assert.equal(n.grid, "quad");
    assert.deepEqual(n.order, ["t3", "t1", "t2", "t4"]);
    assert.deepEqual(n.slips, { letters: true, stack: false, wall: true });
  });

  it("parse：垃圾与空串返回 null；缺内置档时补默认", () => {
    assert.equal(parseBinderyDoc(null), null);
    assert.equal(parseBinderyDoc("not json"), null);
    assert.equal(parseBinderyDoc('{"presets":[]}'), null);
    const repaired = parseBinderyDoc(JSON.stringify({ presets: [{ id: "u1", name: "日课", data: { grid: "duo", order: [], slips: {} } }], activeId: "missing" }));
    assert.ok(repaired);
    assert.equal(repaired.presets[0].builtin, true); // 补默认到首位
    assert.equal(repaired.activeId, BINDERY_DEFAULT_PRESET_ID);
  });

  it("旧单档迁移：kamiBinderyHero → 「旧档」激活并落新键、清旧键", () => {
    const store = new Map<string, string>();
    store.set("kamiBinderyHero", JSON.stringify({ layout: "duo", order: ["t3", "t1", "t4", "t2"], slips: { letters: 1, stack: 1, wall: 0 } }));
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const doc = loadBinderyDoc(fake);
    assert.deepEqual(doc.presets.map((p) => p.name), ["默认", "旧档"]);
    assert.equal(doc.activeId, "u-legacy");
    assert.deepEqual(doc.presets[1].data.order, ["t3", "t1", "t4", "t2"]);
    assert.equal(doc.presets[1].data.slips.wall, false);
    assert.ok(store.has("kamiBinderyHeroV2"));
    assert.ok(!store.has("kamiBinderyHero"));
  });

  it("读写往返：save→load 不丢档", () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const doc = withUserPreset();
    saveBinderyDoc(doc, fake);
    assert.deepEqual(loadBinderyDoc(fake), doc);
  });
});

describe("bindery-hero 印章头日期", () => {
  it("中文数字日：一/十/十五/二十/廿六/三十/卅一，越界空串", () => {
    assert.equal(cnDayChar(1), "一");
    assert.equal(cnDayChar(10), "十");
    assert.equal(cnDayChar(15), "十五");
    assert.equal(cnDayChar(20), "二十");
    assert.equal(cnDayChar(26), "廿六");
    assert.equal(cnDayChar(30), "三十");
    assert.equal(cnDayChar(31), "卅一");
    assert.equal(cnDayChar(0), "");
    assert.equal(cnDayChar(99), "");
  });

  it("排格标签与钳制", () => {
    assert.equal(gridLabel(clampBinderyGrid("feature")), "主幅");
    assert.equal(clampBinderyGrid("nope"), "quad");
  });
});
