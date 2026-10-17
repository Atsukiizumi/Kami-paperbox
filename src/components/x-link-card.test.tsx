/**
 * XLinkCard（画师页 X 关联卡）RTL：手动录入三形态 round-trip 与非法拒绝、
 * 双源建议去重/双标、ignoredHandles 过滤、采纳/忽略/解除写 xAssociations、
 * 忽略记忆随转正保留、中文输入法 isComposing 守卫、v15 旧档容错；外加
 * parseXHandleInput 与 upstream twitterHandleFromUrl 的 URL 样本交叉断言
 * （x-settings 镜像防漂，同 X_DEFAULT_QUERY_IDS 惯例）。
 * 环境垫片：../test/dom.ts 必须最先引入。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { XLinkCard } from "./x-link-card.tsx";
import { parseXHandleInput } from "@/lib/x-settings";
import { twitterHandleFromUrl } from "@/lib/upstream/pixiv.ts";
import { useSettings } from "@/lib/store";
import type { XAssociation } from "@/lib/types";

function assocOf(key: string): XAssociation | undefined {
  return useSettings.getState().xAssociations[key];
}

describe("XLinkCard（画师页 X 关联卡）", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ xAssociations: {} });
  });

  it("parseXHandleInput 与 upstream twitterHandleFromUrl 的 URL 语义一致（镜像防漂）", () => {
    const samples = [
      "https://x.com/masara",
      "https://twitter.com/pixiv",
      "https://x.com/masara/status/123",
      "https://x.com/masara?lang=ja",
      "https://x.com/intent/tweet",
      "https://x.com/",
      "https://x.com/thishandlewaytoolong",
    ];
    for (const sample of samples) {
      assert.equal(parseXHandleInput(sample), twitterHandleFromUrl(sample), sample);
    }
  });

  it("手动录入三形态 round-trip：@handle / 裸 / x.com 与 twitter.com URL 都入库 manual", () => {
    const forms = [
      "@masara",
      "masara",
      "https://x.com/masara",
      "https://twitter.com/masara/status/123",
      "x.com/masara",
    ];
    for (const form of forms) {
      useSettings.setState({ xAssociations: {} });
      render(<XLinkCard authorId="u1" name="画师A" />);
      fireEvent.click(screen.getByRole("button", { name: "关联 X 账号" }));
      fireEvent.change(screen.getByLabelText("X handle"), { target: { value: form } });
      fireEvent.click(screen.getByRole("button", { name: "关联" }));
      const rec = assocOf("pixiv:u1");
      assert.equal(rec?.handle, "masara", `${form} → masara`);
      assert.equal(rec?.origin, "manual");
      assert.ok(typeof rec?.addedAt === "number" && rec.addedAt > 0);
      cleanup();
    }
  });

  it("手动录入非法输入：空/空格/超 15 位/非法字符/他站 URL 内联提示且不提交", () => {
    const bads = ["", "bad handle", "thishandlewaytoolong", "@bad!", "https://www.pixiv.net/users/123"];
    for (const bad of bads) {
      useSettings.setState({ xAssociations: {} });
      render(<XLinkCard authorId="u1" name="画师A" />);
      fireEvent.click(screen.getByRole("button", { name: "关联 X 账号" }));
      fireEvent.change(screen.getByLabelText("X handle"), { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "关联" }));
      assert.ok(screen.getByText(/没认出这是 X handle/), `${JSON.stringify(bad)} 有内联提示`);
      assert.equal(assocOf("pixiv:u1"), undefined, `${JSON.stringify(bad)} 不入库`);
      cleanup();
    }
  });

  it("建议列表：双源一致去重成一条并标双源；两源各异成两条；ignoredHandles 过滤被忽略者", () => {
    // 大小写不敏感去重：social 保存原样大小写，昵称尾巴已小写——同一条
    const { rerender } = render(<XLinkCard authorId="u2" name="畫師まさら＠masara" socialTwitter="Masara" />);
    assert.equal(screen.getAllByRole("button", { name: "采纳" }).length, 1, "双源一致只显示一条");
    assert.ok(screen.getByText("主页外链+昵称"), "一致时标双源");
    assert.ok(screen.getByText("@Masara"), "展示主页外链的原样大小写");

    rerender(<XLinkCard authorId="u2" name="畫師A@someone" socialTwitter="pixiv" />);
    assert.equal(screen.getAllByRole("button", { name: "采纳" }).length, 2, "两源各异成两条");
    assert.ok(screen.getByText("主页外链"));
    assert.ok(screen.getByText("昵称"));

    // 仅忽略记录（handle ∈ 自己的 ignoredHandles）：不当作已关联，只挡掉该建议
    useSettings.setState({
      xAssociations: { "pixiv:u2": { handle: "someone", origin: "auto", addedAt: 1, ignoredHandles: ["someone"] } },
    });
    rerender(<XLinkCard authorId="u2" name="畫師A@someone" socialTwitter="pixiv" />);
    assert.equal(screen.getAllByRole("button", { name: "采纳" }).length, 1, "被忽略的 someone 不再出现");
    assert.ok(screen.getByText("@pixiv"));
    assert.equal(screen.queryByText(/@someone/), null);
  });

  it("采纳/忽略/解除交互：写 store、卡片翻面、忽略记忆随转正保留", () => {
    render(<XLinkCard authorId="u3" name="畫師A@tail0" socialTwitter="main0" />);
    // 采纳首条（主页外链信号在前）→ auto 入库、翻已关联态
    fireEvent.click(screen.getAllByRole("button", { name: "采纳" })[0]);
    assert.equal(assocOf("pixiv:u3")?.handle, "main0");
    assert.equal(assocOf("pixiv:u3")?.origin, "auto");
    assert.ok(screen.getByText("@main0"));
    assert.ok(screen.getByText("自动发现"));
    const link = screen.getByRole("link", { name: "去 X 预览" });
    assert.equal(link.getAttribute("href"), "/x/main0");
    assert.equal(screen.queryByRole("button", { name: "采纳" }), null, "已关联态不再列建议");

    // 解除 → 键删除、回未关联态（建议重现）
    fireEvent.click(screen.getByRole("button", { name: "解除" }));
    assert.equal(assocOf("pixiv:u3"), undefined);
    assert.equal(screen.getAllByRole("button", { name: "采纳" }).length, 2, "解除后回未关联态");

    // 忽略 tail0 → 建仅忽略记录，该建议消失；再忽略 main0 → 建议清空折叠成一行入口
    fireEvent.click(screen.getAllByRole("button", { name: "忽略" })[1]);
    const ignoredRec = assocOf("pixiv:u3");
    assert.equal(ignoredRec?.handle, "tail0");
    assert.equal(ignoredRec?.origin, "auto");
    assert.deepEqual(ignoredRec?.ignoredHandles, ["tail0"]);
    assert.equal(screen.getAllByRole("button", { name: "采纳" }).length, 1);
    assert.equal(screen.queryByText(/@tail0/), null, "被忽略的建议立即消失");

    fireEvent.click(screen.getAllByRole("button", { name: "忽略" })[0]);
    assert.equal(screen.queryByRole("button", { name: "采纳" }), null, "建议全忽略后不列建议");
    assert.ok(screen.getByRole("button", { name: "关联 X 账号" }), "折叠成一行入口");

    // 手动录入转正：忽略记忆保留（tail0/main0 留在 ignoredHandles），newone 挪出
    fireEvent.click(screen.getByRole("button", { name: "关联 X 账号" }));
    fireEvent.change(screen.getByLabelText("X handle"), { target: { value: "@newone" } });
    fireEvent.click(screen.getByRole("button", { name: "关联" }));
    const adopted = assocOf("pixiv:u3");
    assert.equal(adopted?.handle, "newone");
    assert.equal(adopted?.origin, "manual");
    assert.deepEqual(adopted?.ignoredHandles, ["tail0", "main0"], "忽略记忆随条目转正保留");
    assert.ok(screen.getByText("@newone"), "转正后翻已关联态");
  });

  it("中文输入法组合态的 Enter 不提交（isComposing 守卫），非组合态 Enter 提交", () => {
    render(<XLinkCard authorId="u4" name="画师A" />);
    fireEvent.click(screen.getByRole("button", { name: "关联 X 账号" }));
    const input = screen.getByLabelText("X handle");
    fireEvent.change(input, { target: { value: "@composing" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    assert.equal(assocOf("pixiv:u4"), undefined, "组合态 Enter 是上屏不是提交");
    fireEvent.keyDown(input, { key: "Process" });
    assert.equal(assocOf("pixiv:u4"), undefined, "Process 键同守卫");
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    assert.equal(assocOf("pixiv:u4")?.handle, "composing", "非组合态 Enter 正常提交");
  });

  it("v15 旧档无 xAssociations 字段：组件照常渲染不报错", () => {
    useSettings.setState({ xAssociations: undefined as unknown as Record<string, XAssociation> });
    render(<XLinkCard authorId="u5" name="畫師B@legacy" socialTwitter="legacyhandle" />);
    assert.equal(screen.getAllByRole("button", { name: "采纳" }).length, 2, "建议照常渲染");
  });
});
