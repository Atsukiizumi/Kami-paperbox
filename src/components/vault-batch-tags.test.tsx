/**
 * VaultBatchActions（纸匣批量标签动作区）RTL：
 * 影响张数预览、加标签写规范名、删标签变体同删、零选中禁用。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultMeta } from "@/lib/types";

// PopoverContent 静态引入样式链（kami-drop-in 等）；node:test 不认 .css。
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

const { VaultBatchActions } = await import("./vault-batch-tags.tsx");

function meta(over: Partial<VaultMeta> & Pick<VaultMeta, "key">): VaultMeta {
  return {
    source: "pixiv",
    id: over.key,
    title: over.key,
    author: "画师",
    authorId: "",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 0,
    ...over,
  };
}

// 三张样本：鳴潮原文 / 鸣潮变体 / 无关标签
const ITEMS = [
  meta({ key: "pixiv:1", tags: ["鳴潮"] }),
  meta({ key: "pixiv:2", tags: ["鸣潮", "猫"] }),
  meta({ key: "pixiv:3", tags: ["狗"] }),
];
const ALIASES = { 鸣潮: "鳴潮" };
const TAG_OPTIONS = ["鳴潮", "猫", "狗"];

type Applied = { kind: string; tag: string; entries: { key: string; tags: string[] }[] };

function Harness({ items = ITEMS, aliases = ALIASES, applied }: { items?: VaultMeta[]; aliases?: Record<string, string>; applied: Applied[] }) {
  return (
    <main>
      <VaultBatchActions
        selectedItems={items}
        tagOptions={TAG_OPTIONS}
        tagAliases={aliases}
        onApply={(kind, tag, entries) => {
          applied.push({ kind, tag, entries: entries.map((e) => ({ key: e.meta.key, tags: e.tags })) });
        }}
      />
    </main>
  );
}

describe("VaultBatchActions（批量标签动作区）", () => {
  let applied: Applied[];
  beforeEach(() => {
    cleanup();
    applied = [];
  });

  it("零选中：加/删入口都禁用", () => {
    render(<Harness items={[]} applied={applied} />);
    assert.equal((screen.getByRole("button", { name: "加标签" }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByRole("button", { name: "删标签" }) as HTMLButtonElement).disabled, true);
  });

  it("加标签：输入变体名按规范名写入，已有同展示名的条目不计影响", () => {
    render(<Harness applied={applied} />);
    fireEvent.click(screen.getByRole("button", { name: "加标签" }));
    // 输入变体「鸣潮」→ 写规范名「鳴潮」；pixiv:1 原文已有、pixiv:2 的变体归一后同展示名，
    // 都算「已有效」不重复写——只有 pixiv:3 真正被改写
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "鸣潮" } });
    assert.match(screen.getByText(/将按规范名「鳴潮」写入/).textContent ?? "", /鳴潮/);
    const confirm = screen.getByRole("button", { name: /加标签 · 影响 1 张/ }) as HTMLButtonElement;
    fireEvent.click(confirm);
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0], {
      kind: "add",
      tag: "鳴潮",
      entries: [{ key: "pixiv:3", tags: ["狗", "鳴潮"] }],
    });
  });

  it("加标签：已有标签的整批都不变时确认钮禁用（影响 0 张不虚报）", () => {
    const allTagged = [meta({ key: "pixiv:1", tags: ["鳴潮"] })];
    render(<Harness items={allTagged} applied={applied} />);
    fireEvent.click(screen.getByRole("button", { name: "加标签" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "鸣潮" } });
    assert.equal((screen.getByRole("button", { name: /加标签 · 影响 0 张/ }) as HTMLButtonElement).disabled, true);
    assert.equal(applied.length, 0);
  });

  it("删标签：按展示名并集挑选，变体原文一起删", () => {
    render(<Harness applied={applied} />);
    fireEvent.click(screen.getByRole("button", { name: "删标签" }));
    assert.ok(screen.getByText(/从 3 张选中的藏品里删标签/));
    // 并集把「鸣潮」并入「鳴潮」一笺
    for (const name of ["鳴潮", "猫", "狗"]) {
      assert.ok(screen.getByRole("button", { name }), name);
    }
    fireEvent.click(screen.getByRole("button", { name: "鳴潮" }));
    const confirm = screen.getByRole("button", { name: /删标签 · 影响 2 张/ }) as HTMLButtonElement;
    fireEvent.click(confirm);
    assert.deepEqual(applied[0], {
      kind: "remove",
      tag: "鳴潮",
      entries: [
        { key: "pixiv:1", tags: [] }, // 原文「鳴潮」删掉
        { key: "pixiv:2", tags: ["猫"] }, // 变体原文「鸣潮」一起删，其余保序
      ],
    });
  });
});
