/**
 * useBatchSelection hook 测试：锁从 creator / user 页抽出的选择语义（行为零变化）。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBatchSelection } from "./use-batch-selection.ts";

function Harness({ keys = ["a", "b"] }: { keys?: string[] }) {
  const sel = useBatchSelection();
  return (
    <main>
      <span data-testid="state">{`${sel.active ? "on" : "off"}|${[...sel.selected].sort().join(",")}`}</span>
      <button onClick={sel.toggleActive}>toggleActive</button>
      <button onClick={sel.exit}>exit</button>
      <button onClick={() => sel.toggle("a")}>toggle-a</button>
      <button onClick={() => sel.toggle("c")}>toggle-c</button>
      <button onClick={() => sel.selectAll(keys)}>selectAll</button>
      <button onClick={sel.clear}>clear</button>
    </main>
  );
}

function stateText(): string {
  return screen.getByTestId("state").textContent ?? "";
}

describe("useBatchSelection（批量选择）", () => {
  beforeEach(() => cleanup());

  it("初始：选择模式关、集合为空", () => {
    render(<Harness />);
    assert.equal(stateText(), "off|");
  });

  it("toggle 只动集合不动开关；再点同一 key 取消", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "toggle-a" }));
    assert.equal(stateText(), "off|a");
    fireEvent.click(screen.getByRole("button", { name: "toggle-a" }));
    assert.equal(stateText(), "off|");
  });

  it("toggleActive 开门并清空；再切关也清空", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "toggle-a" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-c" }));
    fireEvent.click(screen.getByRole("button", { name: "toggleActive" }));
    assert.equal(stateText(), "on|");
    fireEvent.click(screen.getByRole("button", { name: "toggle-a" }));
    fireEvent.click(screen.getByRole("button", { name: "toggleActive" }));
    assert.equal(stateText(), "off|");
  });

  it("selectAll 全量替换；clear 清集合但保持开着", () => {
    render(<Harness keys={["x", "y"]} />);
    fireEvent.click(screen.getByRole("button", { name: "toggleActive" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-a" }));
    fireEvent.click(screen.getByRole("button", { name: "selectAll" }));
    assert.equal(stateText(), "on|x,y");
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    assert.equal(stateText(), "on|");
  });

  it("exit 退出并清空（工具条完成钮语义）", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "toggleActive" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-a" }));
    fireEvent.click(screen.getByRole("button", { name: "exit" }));
    assert.equal(stateText(), "off|");
  });
});
