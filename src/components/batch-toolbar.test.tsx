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
    fireEvent.click(screen.getByRole("button", { name: /全选本页/ }));
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
});
