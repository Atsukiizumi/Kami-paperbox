/**
 * VaultFilter（纸匣筛选纸）RTL：关闭态无作者下拉；开纸选站点后页上出笺。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useTagLexicon } from "@/lib/tag-lexicon";
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

function Harness({
  initial = EMPTY_VAULT_FILTER,
  tagOptions = ["猫", "原创"],
  booruTagKeys = new Set<string>(),
}: {
  initial?: VaultFilterState;
  tagOptions?: string[];
  booruTagKeys?: Set<string>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <main>
      <VaultFilter
        value={value}
        onChange={setValue}
        authors={[{ key: "pixiv:1", name: "画师A", count: 3 }]}
        tagOptions={tagOptions}
        booruTagKeys={booruTagKeys}
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

describe("VaultFilter 未翻笺弱标记（booruTagKeys + 词表判定）", () => {
  beforeEach(() => {
    cleanup();
    useTagLexicon.setState({ rows: [] }); // 隔离词表状态，不串其他用例
  });

  it("booru 侧出现过且词表未命中的笺：前置小点 + title=未翻译；同域已翻笺不标", () => {
    render(
      <Harness
        tagOptions={["megami_magazine", "sky", "猫"]}
        booruTagKeys={new Set(["megami_magazine", "sky", "猫"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    const untranslated = screen.getByRole("button", { name: "megami_magazine" });
    assert.equal(untranslated.getAttribute("title"), "未翻译：megami_magazine");
    assert.ok(untranslated.querySelector("span[aria-hidden='true']"), "未翻笺要前置小点");
    // sky 内置词表命中（天空）：同在 booru 域也不标
    const translated = screen.getByRole("button", { name: "sky" });
    assert.equal(translated.getAttribute("title"), null);
    assert.equal(translated.querySelector("span[aria-hidden='true']"), null);
    // CJK 笺不是 lexicon-target：即便 booru 侧出现过也不标
    const cjk = screen.getByRole("button", { name: "猫" });
    assert.equal(cjk.getAttribute("title"), null);
  });

  it("纯 pixiv 笺（booru 侧没出现过）不标，即使词表未命中", () => {
    render(<Harness tagOptions={["wutheringwaves_2024"]} booruTagKeys={new Set<string>()} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    const chip = screen.getByRole("button", { name: "wutheringwaves_2024" });
    assert.equal(chip.getAttribute("title"), null);
    assert.equal(chip.querySelector("span[aria-hidden='true']"), null);
  });

  it("词表补录后（setState 预置 rows）同一笺不再标", () => {
    useTagLexicon.setState({ rows: [{ en: "megami_magazine", zh: "Megami 杂志" }] });
    render(<Harness tagOptions={["megami_magazine"]} booruTagKeys={new Set(["megami_magazine"])} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    const chip = screen.getByRole("button", { name: "megami_magazine" });
    assert.equal(chip.getAttribute("title"), null);
    assert.equal(chip.querySelector("span[aria-hidden='true']"), null);
  });
});
