/**
 * VaultTimeline（回忆流视图，10-11-wlm）。
 *
 * 作用：锁「月份分隔头倒序 + 计数」「chip 点击 scrollIntoView 并立刻置 active」
 *       「3 月起步 + 哨兵触发渐进后新月份补 observe」「空态」四条线。
 * 样板：collections-bar.test.tsx（dom 垫片 + CSS 钩子 + 事件类拷贝 + Provider 桩）。
 * IntersectionObserver：masonry-board 的模块级观察器在组件 import 时已拿 dom.ts
 *       的自动触发桩；这里在 import 之后换受控桩，只接渲染期观察器（timeline
 *       自身 + InfiniteSentinel），事件由测试手动 fire。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { VaultMeta } from "@/lib/types";

// 组件链静态引入样式；node:test 不认 .css（同 collections-bar.test.tsx）
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
  // useVaultCover 的封面链在 jsdom 没有 IndexedDB：open 桩永不回调，安静悬着（同样板）
  if (g.indexedDB === undefined) g.indexedDB = { open: () => ({}) };
}

const { VaultTimeline } = await import("./vault-timeline.tsx");

/** 受控 IntersectionObserver：observe 只记录不触发，事件由测试 fire。 */
class IOStub {
  static created: IOStub[] = [];
  cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
  observed: Element[] = [];
  root: Element | null = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
  constructor(cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    this.cb = cb;
    IOStub.created.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve(target: Element) {
    this.observed = this.observed.filter((t) => t !== target);
  }
  disconnect() {
    this.observed = [];
  }
  takeRecords() {
    return [];
  }
  fire(targets: Element[]) {
    this.cb(targets.map((target) => ({ target, isIntersecting: true })));
  }
}
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = IOStub;

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function meta(key: string, savedAt: number): VaultMeta {
  return {
    key,
    source: "pixiv",
    id: key.slice("pixiv:".length),
    title: `t-${key}`,
    author: "画师",
    authorId: "1",
    tags: [],
    pageCount: 1,
    savedAt,
    bytes: 0,
  };
}

// 四个月：2026-09 两条、2026-08/07/06 各一条（组内 savedAt 倒序口径在 vault-query 单测锁）
const d = (month: number, day: number) => new Date(2026, month, day).getTime();
const ITEMS: VaultMeta[] = [
  meta("pixiv:b", d(8, 15)),
  meta("pixiv:a", d(8, 2)),
  meta("pixiv:c", d(7, 10)),
  meta("pixiv:d", d(6, 10)),
  meta("pixiv:e", d(5, 10)),
];

function renderTimeline(items: VaultMeta[] = ITEMS) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={stubRouter as never}>
        <VaultTimeline items={items} tagAliases={{}} onBack={() => undefined} />
      </AppRouterContext.Provider>
    </QueryClientProvider>,
  );
}

describe("VaultTimeline（回忆流）", () => {
  beforeEach(() => {
    cleanup();
    IOStub.created = [];
  });
  afterEach(() => {
    cleanup();
  });

  it("月份分隔头倒序 + 计数；chip 行列全量月份；渐进 3 月起步", () => {
    const { container } = renderTimeline();
    const sections = container.querySelectorAll("section[data-month]");
    assert.equal(sections.length, 3, "3 月起步：哨兵未触发不铺满");
    assert.deepEqual(
      [...sections].map((s) => s.getAttribute("data-month")),
      ["2026-09", "2026-08", "2026-07"],
      "月份倒序（最新月在上 = 默认定位最新月）",
    );
    assert.ok(screen.getByText("2026 年 9 月 · 2 张"), "分隔头计数");
    assert.ok(screen.getByText("2026 年 8 月 · 1 张"));
    // chip 行列全量月份（含还没渲染的 2026-06）
    assert.ok(screen.getByRole("button", { name: "2026-09 · 2" }));
    assert.ok(screen.getByRole("button", { name: "2026-06 · 1" }), "未渲染月份的 chip 也在行上");
  });

  it("chip 点击：scrollIntoView 命中对应月份段，立刻置 active 不等观察器", () => {
    const calls: Array<{ el: Element; options: unknown }> = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(options?: ScrollIntoViewOptions) {
      calls.push({ el: this, options });
    };
    try {
      renderTimeline();
      fireEvent.click(screen.getByRole("button", { name: "2026-07 · 1" }));
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.el.getAttribute("data-month"), "2026-07", "滚到该月 section");
      assert.equal((calls[0]?.options as { behavior?: string } | undefined)?.behavior, "smooth");
      assert.equal(
        screen.getByRole("button", { name: "2026-07 · 1" }).getAttribute("aria-current"),
        "true",
        "点击立刻置 active",
      );
      assert.equal(screen.queryByRole("button", { name: "2026-09 · 2" })?.getAttribute("aria-current"), null);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("哨兵触发渐进：+3 月铺满；新月份段被重挂的观察器补 observe", () => {
    const { container } = renderTimeline();
    assert.equal(container.querySelectorAll("section[data-month]").length, 3);
    act(() => {
      IOStub.created.forEach((io) => io.fire(io.observed)); // 含 InfiniteSentinel 的哨兵
    });
    assert.equal(container.querySelectorAll("section[data-month]").length, 4, "+3 月后全量铺满（4 < 3+3）");
    assert.ok(screen.getByText("2026 年 6 月 · 1 张"), "新月份段带分隔头");
    const observers = IOStub.created.filter((io) => io.observed.length === 4);
    assert.equal(observers.length, 1, "观察器随渲染切片重挂：新观察器看全部 4 段");
  });

  it("当前可视月高亮：观察器报进入视口的月份段，chip aria-current 跟随", () => {
    const { container } = renderTimeline();
    const headerObserver = IOStub.created.find((io) => io.observed.length === 3);
    assert.ok(headerObserver, "月份观察器 observe 全部已渲染段");
    const target = container.querySelector('section[data-month="2026-08"]');
    assert.ok(target);
    act(() => headerObserver!.fire([target!]));
    assert.equal(screen.getByRole("button", { name: "2026-08 · 1" }).getAttribute("aria-current"), "true");
    assert.equal(screen.queryByRole("button", { name: "2026-09 · 2" })?.getAttribute("aria-current"), null);
  });

  it("空态：无月份给 EmptySheet，零 chip 零分段", () => {
    const { container } = renderTimeline([]);
    assert.ok(screen.getByText("回忆流还是空的"));
    assert.equal(container.querySelectorAll("section[data-month]").length, 0);
    assert.equal(container.querySelectorAll("[data-month-chip]").length, 0);
  });

  it("chip 跳到渐进渲染未铺到的月份：扩切片后补滚到位（trellis-check P1）", async () => {
    const { container } = renderTimeline();
    assert.equal(container.querySelectorAll("section[data-month]").length, 3, "前提：4 个月仅铺 3");
    // 滚动 spy 挂 HTMLElement.prototype（dom.ts 垫片挂在这层，挂 Element 会被遮蔽）
    const scrolls: Array<string | null> = [];
    const orig = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function spy(this: HTMLElement) {
      scrolls.push(this.getAttribute("data-month"));
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: "2026-06 · 1" }));
      // 切片扩到含目标月 → 段挂载 → pending effect 补滚
      await waitFor(() => {
        assert.ok(scrolls.includes("2026-06"), "目标月段挂载后补滚到位");
      });
      assert.equal(container.querySelectorAll("section[data-month]").length, 4, "切片已扩满全部月份");
    } finally {
      HTMLElement.prototype.scrollIntoView = orig;
    }
  });
});

