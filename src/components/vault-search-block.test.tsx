/**
 * VaultSearchBlock RTL（M2-2，样板 collections-bar.test.tsx）。
 *
 * 作用：锁三态渲染——unavailable 整块不渲染（访客零感知）、有命中出
 *       「已收藏」标 + 距离 + 作品页链接、空命中一行提示。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactElement } from "react";
import { VaultSearchBlock, type VaultSearchMatch } from "./vault-search-block.tsx";

// 组件链静态引入样式；node:test 不认 .css。
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

function match(over: Partial<VaultSearchMatch>): VaultSearchMatch {
  return {
    key: "yande:9001",
    source: "yande",
    id: "9001",
    title: "同图藏品",
    author: "画师",
    pageCount: 1,
    bytes: 0,
    savedAt: 1,
    hasFile: true,
    distance: 7,
    ...over,
  };
}

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={stubRouter as never}>{ui}</AppRouterContext.Provider>
    </QueryClientProvider>,
  );
}

describe("VaultSearchBlock（你的纸匣块）", () => {
  beforeEach(() => cleanup());

  it("unavailable 整块不渲染（访客 401 / 服务端不可用零感知）", () => {
    const { container } = renderWithProviders(<VaultSearchBlock state={{ state: "unavailable" }} />);
    assert.equal(container.textContent, "");
  });

  it("有命中：已收藏标 + 距离 + 作品页链接；hasFile=false 画占位", () => {
    renderWithProviders(
      <VaultSearchBlock
        state={{
          state: "ready",
          matches: [
            match({}),
            match({ key: "pixiv:77", source: "pixiv", id: "77", title: "无文件", hasFile: false, distance: 9 }),
          ],
        }}
      />,
    );
    assert.ok(screen.getByText("你的纸匣"));
    assert.equal(screen.getAllByText("已收藏").length, 2, "每张命中卡一枚标");
    assert.ok(screen.getByText("距离 7"));
    const link = screen.getByRole("link", { name: /同图藏品/ });
    assert.equal(link.getAttribute("href"), "/work/yande/9001");
    assert.ok(screen.getByText("无预览"), "无文件条目画占位不出图");
    assert.equal(screen.getByRole("link", { name: /无文件/ }).getAttribute("href"), "/work/pixiv/77");
  });

  it("空命中：一行提示且块保持可见（用户才知道功能存在）", () => {
    renderWithProviders(<VaultSearchBlock state={{ state: "ready", matches: [] }} />);
    assert.ok(screen.getByText("你的纸匣"));
    assert.ok(screen.getByText("纸匣里没有近似的图。"));
  });
});
