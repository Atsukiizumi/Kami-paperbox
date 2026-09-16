/**
 * BatchToolbar（批量收藏浮动条）组件测试。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BatchToolbar } from "./batch-toolbar.tsx";

describe("BatchToolbar（批量收藏）", () => {
  let events: string[];
  beforeEach(() => {
    cleanup();
    events = [];
  });

  function renderBar(selectedCount: number, total = 10) {
    render(
      <BatchToolbar
        selectedCount={selectedCount}
        total={total}
        onSelectAll={() => events.push("select-all")}
        onClear={() => events.push("clear")}
        onEnqueue={(kind) => events.push(`enqueue:${kind}`)}
        onDone={() => events.push("done")}
      />,
    );
  }

  it("显示已选数；超上限禁用入队", () => {
    renderBar(201);
    assert.match(screen.getByRole("toolbar").textContent ?? "", /201/);
    assert.match(screen.getByRole("toolbar").textContent ?? "", /上限 200/);
    const vault = screen.getByRole("button", { name: /入纸匣/ }) as HTMLButtonElement;
    const download = screen.getByRole("button", { name: /下载/ }) as HTMLButtonElement;
    assert.equal(vault.disabled, true);
    assert.equal(download.disabled, true);
  });

  it("未超限：点击入队回调带 kind", () => {
    renderBar(3);
    fireEvent.click(screen.getByRole("button", { name: /入纸匣/ }));
    fireEvent.click(screen.getByRole("button", { name: /下载/ }));
    assert.deepEqual(events, ["enqueue:vault", "enqueue:download"]);
  });

  it("全选/清除按钮随选择状态切换", () => {
    renderBar(0, 10);
    fireEvent.click(screen.getByRole("button", { name: /全选/ }));
    assert.deepEqual(events, ["select-all"]);
  });

  it("全选后按钮变清除", () => {
    renderBar(10, 10);
    fireEvent.click(screen.getByRole("button", { name: /清除/ }));
    assert.deepEqual(events, ["clear"]);
  });

  it("完成按钮触发 onDone；零选中禁用入队", () => {
    renderBar(0);
    const vault = screen.getByRole("button", { name: /入纸匣/ }) as HTMLButtonElement;
    assert.equal(vault.disabled, true);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    assert.deepEqual(events, ["done"]);
  });

  it("children 替换默认动作区（纸匣批量整理：没有入纸匣/下载）", () => {
    render(
      <BatchToolbar
        selectedCount={2}
        total={10}
        onSelectAll={() => events.push("select-all")}
        onClear={() => events.push("clear")}
        onDone={() => events.push("done")}
        label="批量整理"
      >
        <button onClick={() => events.push("tag")}>加标签</button>
      </BatchToolbar>,
    );
    assert.equal(screen.queryByRole("button", { name: /入纸匣/ }), null);
    assert.equal(screen.queryByRole("button", { name: /下载/ }), null);
    assert.equal(screen.getByRole("toolbar").getAttribute("aria-label"), "批量整理");
    fireEvent.click(screen.getByRole("button", { name: /加标签/ }));
    assert.deepEqual(events, ["tag"]);
  });

  it("children={null} 是只读工具条：只有计数、全选/清除、完成", () => {
    render(
      <BatchToolbar
        selectedCount={0}
        total={5}
        onSelectAll={() => events.push("select-all")}
        onClear={() => events.push("clear")}
        onDone={() => events.push("done")}
      >
        {null}
      </BatchToolbar>,
    );
    assert.equal(screen.queryByRole("button", { name: /入纸匣/ }), null);
    fireEvent.click(screen.getByRole("button", { name: /全选/ }));
    assert.deepEqual(events, ["select-all"]);
  });

  it("max={null} 解除上限：超 BATCH_MAX 也不禁用、不出上限文案", () => {
    render(
      <BatchToolbar
        selectedCount={300}
        total={400}
        max={null}
        onSelectAll={() => events.push("select-all")}
        onClear={() => events.push("clear")}
        onDone={() => events.push("done")}
      >
        <button onClick={() => events.push("tag")}>加标签</button>
      </BatchToolbar>,
    );
    assert.equal(screen.getByRole("toolbar").textContent?.includes("上限"), false);
    const add = screen.getByRole("button", { name: /加标签/ }) as HTMLButtonElement;
    assert.equal(add.disabled, false);
  });
});
