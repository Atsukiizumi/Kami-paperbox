/**
 * 键盘流焦点守卫回归（trellis-check P0）：动作信号广播给整页卡片，
 * 只有焦点卡执行——S 一次只入队一张；无焦点不作用；翻页重挂载不重放旧动作。
 */
import "../test/dom.ts";
import type { ReactElement } from "react";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ArtworkGrid } from "./artwork-grid.tsx";
import { useQueue } from "@/lib/store";
import type { WorkCard } from "@/lib/types";

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

type Kb = { focusIndex: number | null; action: { seq: number; kind: "save" | "like" | "preview" } | null };

function renderGrid(items: WorkCard[], keyboard: Kb) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const ui: ReactElement = <ArtworkGrid items={items} keyboard={keyboard} />;
  return render(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={stubRouter as never}>{ui}</AppRouterContext.Provider>
    </QueryClientProvider>,
  );
}

const w = (i: number): WorkCard => ({
  source: "pixiv",
  id: String(i),
  title: `t${i}`,
  author: "a",
  authorId: "1",
  thumb: "",
  pageCount: 1,
  tags: [],
});

function queued() {
  return useQueue.getState().items.filter((x) => x.kind !== "download");
}

describe("键盘流焦点守卫（P0 回归）", () => {
  beforeEach(() => {
    cleanup();
    useQueue.setState({ items: [] });
  });

  it("save 信号只作用焦点卡：两卡网格只入队 1 张", () => {
    const items = [w(1), w(2)];
    // 真实流：先挂载（action=null），按键后才出现信号——rerender 模拟
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    const shell = (kb: Kb) => (
      <QueryClientProvider client={client}>
        <AppRouterContext.Provider value={stubRouter as never}>
          <ArtworkGrid items={items} keyboard={kb} />
        </AppRouterContext.Provider>
      </QueryClientProvider>
    );
    const { rerender } = render(shell({ focusIndex: 0, action: null }));
    rerender(shell({ focusIndex: 0, action: { seq: 1, kind: "save" } }));
    assert.equal(queued().length, 1, "只有焦点卡入队");
    assert.equal(queued()[0]?.id, "1");
  });

  it("无焦点时信号不作用任何卡", () => {
    const items = [w(1), w(2)];
    renderGrid(items, { focusIndex: null, action: { seq: 1, kind: "save" } });
    assert.equal(queued().length, 0);
  });

  it("非零 seq 挂载即带（翻页旧动作）不重放", () => {
    const items = [w(3), w(4)];
    renderGrid(items, { focusIndex: 1, action: { seq: 5, kind: "save" } });
    assert.equal(queued().length, 0, "挂载基线吞掉旧 seq，不重放");
  });
});
