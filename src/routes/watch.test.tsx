/**
 * 追踪页标签订阅视图（09-21-tag-watch-vault-filter）。
 *
 * 作用：锁「画师/标签分段切换」「标签行渲染与取消订阅」「添加标签表单入列」三条 UI 接线。
 * 环境垫片：../test/dom.ts 必须最先引入；检查更新走真 fetch（jsdom 下会失败，
 *        结果行只显示失败态，不影响断言——不 mock 网络层）。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WatchPage } from "./watch.tsx";
import { useSettings } from "@/lib/store";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** WatchPage 用 useNavigate（app router context）；测试里挂一个空桩路由。 */
const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function renderPage() {
  return render(
    <AppRouterContext.Provider value={stubRouter as never}>
      <WatchPage />
    </AppRouterContext.Provider>,
  );
}

describe("追踪页标签订阅", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ watchArtists: [], watchTags: [], watchLimit: 100 });
  });

  it("切到标签视图：空态提示 → 添加表单订阅入列 → 取消订阅清空", () => {
    renderPage();
    // 默认画师视图：空态
    assert.ok(screen.getByText(/还没有追踪的画师/));
    // 切到标签视图：空态提示两个入口
    fireEvent.click(screen.getByRole("radio", { name: "标签" }));
    assert.ok(screen.getByText(/还没有订阅的标签/));
    // 添加表单：输入标签回车 → 入列
    const input = screen.getByLabelText("订阅标签");
    fireEvent.change(input, { target: { value: "鳴潮" } });
    fireEvent.keyDown(input, { key: "Enter" });
    assert.equal(useSettings.getState().watchTags.length, 1);
    assert.equal(useSettings.getState().watchTags[0]?.tag, "鳴潮");
    // 标签行渲染 + 取消订阅
    const row = screen.getByText("鳴潮");
    assert.ok(row);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    assert.equal(useSettings.getState().watchTags.length, 0, "取消订阅即出列");
  });

  it("同词重复订阅不重复入列（toast 提示路径不炸）", () => {
    useSettings.setState({
      watchTags: [{ source: "pixiv", tag: "鳴潮", addedAt: 1 }],
    });
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "标签" }));
    const input = screen.getByLabelText("订阅标签");
    fireEvent.change(input, { target: { value: "鳴潮" } });
    fireEvent.click(screen.getByRole("button", { name: /^订阅$/ }));
    assert.equal(useSettings.getState().watchTags.length, 1, "同词不再入列");
  });
});
