/**
 * VaultFilter（纸匣筛选纸）RTL：关闭态无作者下拉；开纸选站点后页上出笺。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { EMPTY_VAULT_FILTER, type VaultFilterState } from "@/lib/vault-filter";

// MonthPicker 静态引入 react-day-picker/style.css；node:test 不认 .css。
registerHooks({
  load(url, context, nextLoad) {
    if (url.split("?")[0].endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

{
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of ["Event", "CustomEvent", "MouseEvent", "PointerEvent", "KeyboardEvent", "FocusEvent", "MutationObserver"]) {
    if (w[key] !== undefined) g[key] = w[key];
  }
}

const { VaultFilter } = await import("./vault-filter.tsx");

function Harness({ initial = EMPTY_VAULT_FILTER }: { initial?: VaultFilterState }) {
  const [value, setValue] = useState(initial);
  return (
    <main>
      <VaultFilter
        value={value}
        onChange={setValue}
        authors={[{ key: "pixiv:1", name: "画师A", count: 3 }]}
        tagOptions={["猫", "原创"]}
        totals={{ count: 10, bytes: 1024 }}
        showUnread
        showRecall
      />
    </main>
  );
}

function clickPixivInPaper() {
  const radio = screen.queryByRole("radio", { name: "Pixiv" });
  if (radio) {
    fireEvent.click(radio);
    return;
  }
  fireEvent.click(screen.getByText("Pixiv"));
}

describe("VaultFilter", () => {
  beforeEach(() => cleanup());

  it("关闭态只有筛选钮和计数，没有作者 combobox，没有匣里的来源", () => {
    render(<Harness />);
    assert.ok(screen.getByRole("button", { name: "筛选" }));
    assert.equal(screen.queryByRole("combobox"), null);
    assert.equal(screen.queryByText("匣里的来源"), null);
    assert.match(screen.getByText(/条/).textContent ?? "", /10 条/);
  });

  it("点筛选出现筛选纸匣与匣里的来源；选 Pixiv 后面上出现笺", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    assert.ok(screen.getByText("筛选纸匣"));
    assert.ok(screen.getByText("匣里的来源"));
    clickPixivInPaper();
    // 抽屉打开时 vaul 给主栏 aria-hidden，笺仍在关闭态那一行
    assert.ok(screen.getByRole("button", { name: "去掉筛选：Pixiv", hidden: true }));
    assert.match(screen.getByRole("button", { name: /^筛选/, hidden: true }).textContent ?? "", /筛选 · 1/);
  });

  it("点笺清掉站点且不要求纸仍打开", () => {
    render(<Harness initial={{ ...EMPTY_VAULT_FILTER, source: "pixiv" }} />);
    const slip = screen.getByRole("button", { name: "去掉筛选：Pixiv" });
    fireEvent.click(slip);
    assert.equal(screen.queryByRole("button", { name: "去掉筛选：Pixiv" }), null);
    assert.equal(screen.getByRole("button", { name: "筛选" }).getAttribute("aria-expanded"), "false");
  });
});
