/**
 * WorkPage 续读挂点（M2/M4，10-11-wlm）。
 *
 * 作用：锁「query 成功后按 resumePage 定位 data-work-page（一次守卫）」
 *       「data-work-page 用 pages.map 原索引，点该页进灯箱页码同步（M4）」
 *       「关灯箱写一次水位（Esc 与关闭钮同一 onClose，preview 闭包即最后页）」。
 * 样板：watch.test.tsx（AppRouter 桩）+ collections-bar.test.tsx（CSS 钩子）；
 *       useParams 走 PathParamsContext 桩；详情 query 用 setQueryData 预种，
 *       不 mock 网络层（tags 留空让 relatedQuery 自然短路，零 fetch）。
 * jsdom 不滚屏：scrollIntoView 换 Spy 记调用，不测滚动本身。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { WorkDetail } from "@/lib/types";

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
  if (g.indexedDB === undefined) g.indexedDB = { open: () => ({}) };
}

const { WorkPage } = await import("./work.$source.$id.tsx");
const { useViewHistory } = await import("@/lib/view-history");
const { workDetailQueryKey } = await import("@/lib/work-detail");

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

const WORK: WorkDetail = {
  source: "yande",
  id: "7",
  title: "长漫",
  author: "画师",
  authorId: "42",
  thumb: "/t0.jpg",
  pageCount: 5,
  tags: [],
  description: "",
  width: 800,
  height: 1200,
  pages: Array.from({ length: 5 }, (_, i) => ({
    thumb: `/t${i}.jpg`,
    regular: `/r${i}.jpg`,
    original: `/o${i}.jpg`,
    width: 800,
    height: 1200,
    kind: "image" as const,
  })),
};

function seedHistory(lastPage: number | undefined) {
  useViewHistory.setState({
    items: [
      {
        source: "yande",
        id: "7",
        title: "长漫",
        author: "画师",
        authorId: "42",
        thumb: "",
        pageCount: 5,
        viewedAt: Date.now(), // 必须新鲜，90 天窗会 prune 掉远古条目
        ...(lastPage === undefined ? {} : { lastPage }),
      },
    ],
    authors: [],
  });
}

function renderWork() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  // 与 WorkPage 的 useQuery 同键（workDetailQueryKey 读实时设置段，天然一致）
  client.setQueryData(workDetailQueryKey("yande", "7"), WORK);
  return render(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={stubRouter as never}>
        <PathParamsContext.Provider value={{ source: "yande", id: "7" } as never}>
          <WorkPage />
        </PathParamsContext.Provider>
      </AppRouterContext.Provider>
    </QueryClientProvider>,
  );
}

describe("WorkPage 续读挂点", () => {
  beforeEach(() => {
    cleanup();
    seedHistory(1);
  });
  afterEach(() => {
    cleanup();
    useViewHistory.setState({ items: [], authors: [] });
  });

  it("定位：query 成功后滚到水位页一次（守卫）；data-work-page 用 pages.map 原索引", () => {
    const scrolled: Element[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    try {
      const { container } = renderWork();
      const anchors = container.querySelectorAll("[data-work-page]");
      assert.equal(anchors.length, 5, "五页各带锚点（附件混排时也是原索引口径）");
      assert.deepEqual(
        [...anchors].map((a) => a.getAttribute("data-work-page")),
        ["0", "1", "2", "3", "4"],
      );
      assert.equal(scrolled.length, 1, "一次性守卫：单次定位");
      assert.equal(scrolled[0]?.getAttribute("data-work-page"), "1", "定位页 = resumePage(水位 1, 5 页)");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("M4：点第 4 页 figure 进灯箱，页码与正文锚点同一套索引", () => {
    const { container } = renderWork();
    const anchors = container.querySelectorAll("[data-work-page]");
    fireEvent.click(anchors[3]!.querySelector("button")!);
    assert.ok(screen.getByText(/4 \/ 5/), "灯箱页码 4/5 与 data-work-page=3 同源（0-based）");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("关灯箱写一次水位：Esc 与关闭钮同一 onClose，preview 闭包即最后页", () => {
    const { container } = renderWork();
    const anchors = container.querySelectorAll("[data-work-page]");
    // 翻到第 3 页（索引 2）→ Esc 关：水位 1 → 2
    fireEvent.click(anchors[2]!.querySelector("button")!);
    fireEvent.keyDown(window, { key: "Escape" });
    let entry = useViewHistory.getState().items.find((x) => x.source === "yande" && x.id === "7");
    assert.equal(entry?.lastPage, 2, "Esc 路径写水位");
    // 再翻到第 5 页（索引 4）→ 关闭钮关：水位 2 → 4（clamp 到 pageCount−1）
    fireEvent.click(anchors[4]!.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    entry = useViewHistory.getState().items.find((x) => x.source === "yande" && x.id === "7");
    assert.equal(entry?.lastPage, 4);
  });

  it("不定位的情形：水位在首页（等于没翻过）不滚动", () => {
    seedHistory(0);
    const scrolled: Element[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    try {
      renderWork();
      assert.deepEqual(scrolled, [], "resumePage 为 null 不定位");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
