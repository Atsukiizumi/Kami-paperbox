/**
 * TagTidyCard（标签整理卡）RTL：机械簇渲染、挑规范写表、手动归并跨语言、删别名还原。
 * 环境垫片：../../test/dom.ts 必须最先引入；items 走组件注入（不读 IDB）。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagTidyCard } from "./tag-tidy.tsx";
import { useSettings } from "@/lib/store";
import type { VaultMeta } from "@/lib/storage/vault";

function item(key: string, tags: string[]): VaultMeta {
  return {
    key,
    source: "pixiv",
    id: key,
    title: key,
    author: "作者",
    authorId: "",
    tags,
    pageCount: 1,
    savedAt: 1,
    bytes: 0,
  };
}

describe("TagTidyCard（标签整理）", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ tagAliases: {} });
  });

  it("机械变体聚成簇：radio 挑规范写法，统一后写进别名表、簇退出待整理", () => {
    const items = [item("a", ["Waves"]), item("b", ["waves"]), item("c", ["WAves"])];
    render(<TagTidyCard items={items} />);
    // 簇内三个变体各带计数
    assert.ok(screen.getByRole("radio", { name: /Waves × 1/ }));
    assert.ok(screen.getByRole("radio", { name: /waves × 1/ }));
    // 挑小写作法并统一 → 其余两个变体都指向它
    fireEvent.click(screen.getByRole("radio", { name: /waves × 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "统一" }));
    assert.deepEqual(useSettings.getState().tagAliases, { Waves: "waves", WAves: "waves" });
    // 已归一的簇退出待整理，别名列入已保存
    assert.ok(screen.getByText("没有需要整理的标签"));
    assert.ok(screen.getByRole("button", { name: "删除标签别名 Waves" }));
    assert.ok(screen.getByRole("button", { name: "删除标签别名 WAves" }));
  });

  it("手动归并：跨语言变体搜出来勾成一组，手输规范名落同一张别名表", () => {
    const items = [item("a", ["鳴潮"]), item("b", ["WutheringWaves"]), item("c", ["风景"])];
    render(<TagTidyCard items={items} />);
    // 鳴潮 与 WutheringWaves 合不成机械簇（跨语言），待整理为空但手动归并可用
    assert.ok(screen.getByText("没有需要整理的标签"));
    fireEvent.change(screen.getByLabelText("搜索标签"), { target: { value: "wuthering" } });
    fireEvent.click(screen.getByRole("button", { name: /WutheringWaves/ }));
    // 换个搜索词再勾一个：已勾选的换词后仍保持在列
    fireEvent.change(screen.getByLabelText("搜索标签"), { target: { value: "鳴" } });
    fireEvent.click(screen.getByRole("button", { name: /鳴潮/ }));
    fireEvent.change(screen.getByLabelText("手动归并的规范名"), { target: { value: "鸣潮" } });
    fireEvent.click(screen.getByRole("button", { name: "归并" }));
    assert.deepEqual(useSettings.getState().tagAliases, { 鳴潮: "鸣潮", WutheringWaves: "鸣潮" });
  });

  it("删别名还原：已保存列表单删一条，变体回到待整理簇", () => {
    const items = [item("a", ["Waves"]), item("b", ["waves"])];
    useSettings.setState({ tagAliases: { Waves: "waves" } });
    render(<TagTidyCard items={items} />);
    // 别名在位时簇已归一，不列待整理
    assert.ok(screen.getByText("没有需要整理的标签"));
    fireEvent.click(screen.getByRole("button", { name: "删除标签别名 Waves" }));
    assert.deepEqual(useSettings.getState().tagAliases, {});
    // 删掉后变体回到待整理
    assert.ok(screen.getByRole("radio", { name: /Waves × 1/ }));
    assert.ok(screen.getByRole("button", { name: "统一" }));
  });
});
