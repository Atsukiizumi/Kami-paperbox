/**
 * 案头编排部件测试（dom 垫片 + testing-library）。
 *
 * 作用：锁编辑态三件套的交互契约——槽占宽段选回调、编排条托盘上场/存为版式/
 *      完成文案随 dirty 翻转、模块卡收起按钮 stopPropagation 不误选。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeskEditBar, DeskEditCard, DeskEditSlot } from "./desk-edit.tsx";
import { DEFAULT_DESK_LAYOUT, type DeskPreset } from "@/lib/desk-layout";

const PRESETS: DeskPreset[] = [
  { id: "kami-default", name: "稿纸", layout: DEFAULT_DESK_LAYOUT, builtIn: true },
  { id: "p1", name: "夜读", layout: DEFAULT_DESK_LAYOUT },
];

describe("案头编排部件", () => {
  afterEach(() => cleanup());

  it("槽占宽段选：点「满」回调 onSpan(index, 3)", () => {
    let got: [number, 1 | 2 | 3] | null = null;
    render(
      <DeskEditSlot
        slot={DEFAULT_DESK_LAYOUT.slots[0]!}
        index={0}
        dropping={false}
        onDragOver={() => {}}
        onDrop={() => {}}
        onDragLeave={() => {}}
        onSpan={(i, s) => (got = [i, s])}
      >
        <span>内容</span>
      </DeskEditSlot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "满" }));
    assert.deepEqual(got, [0, 3]);
  });

  it("编排条：托盘模块点回上场；dirty 翻转完成文案；存为版式可点", () => {
    const picked: string[] = [];
    let saveAs = 0;
    const { rerender } = render(
      <DeskEditBar
        presets={PRESETS}
        activePresetId="kami-default"
        dirty={false}
        tray={["newspaper"]}
        headerSlip
        onPickPreset={() => {}}
        onToggleHeaderSlip={() => {}}
        onTrayAdd={(id) => picked.push(id)}
        onAddSlot={() => {}}
        onSaveAs={() => (saveAs += 1)}
        onReset={() => {}}
        onDone={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "今日报纸" }));
    assert.deepEqual(picked, ["newspaper"]);
    assert.equal(screen.getByRole("button", { name: "完成" }).textContent, "完成");
    rerender(
      <DeskEditBar
        presets={PRESETS}
        activePresetId="kami-default"
        dirty
        tray={[]}
        headerSlip={false}
        onPickPreset={() => {}}
        onToggleHeaderSlip={() => {}}
        onTrayAdd={() => {}}
        onAddSlot={() => {}}
        onSaveAs={() => (saveAs += 1)}
        onReset={() => {}}
        onDone={() => {}}
      />,
    );
    assert.equal(screen.getByRole("button", { name: "完成并保存" }).textContent, "完成并保存");
    fireEvent.click(screen.getByRole("button", { name: "存为版式" }));
    assert.equal(saveAs, 1);
  });

  it("模块卡：点收起按钮回调 onRemove 且不触发选中", () => {
    let removed = 0;
    let selected = 0;
    render(
      <DeskEditCard
        moduleId="newspaper"
        selected={false}
        onSelect={() => (selected += 1)}
        onRemove={() => (removed += 1)}
        onDragStart={() => {}}
        onDragEnd={() => {}}
      >
        <div>模块预览</div>
      </DeskEditCard>,
    );
    fireEvent.click(screen.getByRole("button", { name: "收起今日报纸" }));
    assert.equal(removed, 1);
    assert.equal(selected, 0, "收起的 stopPropagation 不应顺手选中卡片");
  });
});
