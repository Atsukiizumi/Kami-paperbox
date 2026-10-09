/**
 * CollectionsBar / AddToCollectionPanel / CollectionDetail RTL（09-27-collections）。
 *
 * 作用：锁「合集笺渲染名称 + 有效成员计数（软失效在渲染期，失配 key 不计）」、
 *       「加入面板已有/新建两分支的回传形状」与「详情页重排钮调 store setter
 *       reorderCollectionItem（内部走 moveCollectionItem 纯函数，UI 不直接调纯函数）」。
 * 样板：vault-filter.test.tsx / vault-batch-tags.test.tsx（dom 垫片 + CSS 钩子 +
 *       事件类拷贝）；Provider 桩（QueryClient + AppRouter）照 artwork-kb.test.tsx。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactElement } from "react";
import type { Collection } from "@/lib/collection";
import { useSettings } from "@/lib/store";
import type { VaultMeta } from "@/lib/types";

// 组件链静态引入样式（react-day-picker / kami-drop-in 等）；node:test 不认 .css。
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

// useVaultCover 的封面链在 jsdom 没有 IndexedDB：open 桩的回调永不触发，
// 挂起的封面请求安静悬着（不产生 unhandled rejection；thumb 初值 "" 走占位分支）。
{
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.indexedDB === undefined) g.indexedDB = { open: () => ({}) };
}

const { AddToCollectionPanel, CollectionDetail, CollectionsBar } = await import("./collections-bar.tsx");

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function meta(key: string): VaultMeta {
  return {
    key,
    source: "pixiv",
    id: key.slice("pixiv:".length),
    title: `t-${key}`,
    author: "画师",
    authorId: "1",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 0,
  };
}

const KEYS = new Set(["pixiv:1", "pixiv:2", "pixiv:3"]);
const METAS = new Map(
  ["pixiv:1", "pixiv:2", "pixiv:3"].map((key) => [key, meta(key)] as const),
);

function collectionFixture(over: Partial<Collection> & Pick<Collection, "id" | "name">): Collection {
  return { items: [], createdAt: 1, updatedAt: 2, ...over };
}

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={stubRouter as never}>{ui}</AppRouterContext.Provider>
    </QueryClientProvider>,
  );
}

/** 与 vault.tsx 同口径：详情组件吃 store 里的合集（订阅，重排后顺序真实跟着变）。 */
function CollectionDetailHarness({ id, fallbackName }: { id: string; fallbackName: string }) {
  const collection = useSettings((s) => s.collections.find((c) => c.id === id)) ?? collectionFixture({ id, name: fallbackName });
  return (
    <main>
      <CollectionDetail collection={collection} vaultKeys={KEYS} metas={METAS} tagAliases={{}} onBack={() => undefined} />
    </main>
  );
}

describe("CollectionsBar（合集笺行）", () => {
  beforeEach(() => cleanup());

  it("渲染名称 + 有效成员计数；失配 key 不计入（软失效在渲染期）", () => {
    const collections = [
      collectionFixture({ id: "c1", name: "風景", items: ["pixiv:1", "yande:gone", "pixiv:2"] }),
      collectionFixture({ id: "c2", name: "空空", items: ["yande:gone"] }),
    ];
    const opened: string[] = [];
    render(
      <main>
        <CollectionsBar collections={collections} vaultKeys={KEYS} metas={METAS} onOpen={(id) => opened.push(id)} />
      </main>,
    );
    const c1 = screen.getByRole("button", { name: /風景/ });
    assert.match(c1.textContent ?? "", /風景2/, "计数 = collectionMembers 长度，失配 key 不占数");
    const c2 = screen.getByRole("button", { name: /空空/ });
    assert.match(c2.textContent ?? "", /空空0/, "全失配合集计数 0（不自动删）");
    fireEvent.click(c1);
    assert.deepEqual(opened, ["c1"], "点笺进详情");
  });

  it("空合集数组零占位：一个笺都不渲染", () => {
    const { container } = render(
      <main>
        <CollectionsBar collections={[]} vaultKeys={KEYS} metas={METAS} onOpen={() => undefined} />
      </main>,
    );
    assert.equal(container.querySelectorAll("button").length, 0);
  });
});

describe("AddToCollectionPanel（加入合集弹层内容）", () => {
  beforeEach(() => cleanup());

  it("已有合集分支：列出「名称 · 有效计数」，点笺回传 id", () => {
    const picked: string[] = [];
    render(
      <main>
        <AddToCollectionPanel
          collections={[collectionFixture({ id: "c1", name: "風景", items: ["pixiv:1", "yande:gone"] })]}
          vaultKeys={KEYS}
          onPick={(id) => picked.push(id)}
          onCreate={() => undefined}
        />
      </main>,
    );
    fireEvent.click(screen.getByRole("button", { name: "風景 · 1" }));
    assert.deepEqual(picked, ["c1"]);
  });

  it("空分支：提示建第一个；空名禁用，输入后新建回传 trim 过的名字", () => {
    const created: string[] = [];
    render(
      <main>
        <AddToCollectionPanel
          collections={[]}
          vaultKeys={KEYS}
          onPick={() => undefined}
          onCreate={(name) => created.push(name)}
        />
      </main>,
    );
    assert.ok(screen.getByText("还没有合集，起个名字建第一个。"));
    const create = screen.getByRole("button", { name: "新建合集并加入" }) as HTMLButtonElement;
    assert.equal(create.disabled, true, "空名禁用");
    fireEvent.change(screen.getByPlaceholderText("新合集名字"), { target: { value: "  新合集  " } });
    assert.equal(create.disabled, false);
    fireEvent.click(create);
    assert.deepEqual(created, ["新合集"], "trim 后回传");
  });
});

describe("CollectionDetail（合集详情）", () => {
  let before: Collection[];
  beforeEach(() => {
    cleanup();
    before = useSettings.getState().collections;
  });
  afterEach(() => {
    useSettings.setState({ collections: before });
  });

  it("整理顺序：上移/置顶调 store setter reorderCollectionItem（走纯函数），边界钮禁用", () => {
    useSettings.setState({
      collections: [collectionFixture({ id: "c1", name: "風景", items: ["pixiv:1", "pixiv:2", "pixiv:3"] })],
    });
    renderWithProviders(<CollectionDetailHarness id="c1" fallbackName="風景" />);
    // 开整理态：每卡出上移/下移/置顶三小钮，首项上移与末项下移禁用
    fireEvent.click(screen.getByRole("button", { name: "整理顺序" }));
    const ups = screen.getAllByRole("button", { name: "上移" });
    assert.equal(ups.length, 3);
    assert.equal((ups[0] as HTMLButtonElement).disabled, true, "首项上移禁用");
    const downs = screen.getAllByRole("button", { name: "下移" });
    assert.equal((downs.at(-1) as HTMLButtonElement).disabled, true, "末项下移禁用");
    // 第二张上移：store 里的 items 真被重排（Harness 订阅 store，UI 顺序跟着变）
    fireEvent.click(ups[1] as HTMLButtonElement);
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["pixiv:2", "pixiv:1", "pixiv:3"]);
    // 末卡置顶
    const tops = screen.getAllByRole("button", { name: "置顶" });
    assert.equal(tops.length, 3);
    fireEvent.click(tops[2] as HTMLButtonElement);
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["pixiv:3", "pixiv:2", "pixiv:1"]);
  });

  it("整理顺序：下移越过已经不在纸匣里的 key，那个 key 留在原下标", () => {
    useSettings.setState({
      collections: [collectionFixture({ id: "c1", name: "風景", items: ["pixiv:1", "yande:gone", "pixiv:2"] })],
    });
    renderWithProviders(<CollectionDetailHarness id="c1" fallbackName="風景" />);
    fireEvent.click(screen.getByRole("button", { name: "整理顺序" }));
    const downs = screen.getAllByRole("button", { name: "下移" });
    assert.equal(downs.length, 2, "失配 key 没有卡片");
    fireEvent.click(downs[0] as HTMLButtonElement);
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["pixiv:2", "yande:gone", "pixiv:1"]);
  });

  it("详情网格只渲染仍存在的成员（软失效）；全失配显示空态不删合集", () => {
    useSettings.setState({
      collections: [collectionFixture({ id: "c1", name: "風景", items: ["pixiv:1", "yande:gone"] })],
    });
    renderWithProviders(<CollectionDetailHarness id="c1" fallbackName="風景" />);
    assert.equal(screen.getAllByRole("button", { name: "移出合集" }).length, 1, "失配 key 不渲染成卡");
    assert.ok(screen.getAllByText("t-pixiv:1").length >= 1, "有效成员按 members 顺序渲染（标题出现）");
    assert.equal(screen.queryByText("t-yande:gone"), null);
    cleanup();

    useSettings.setState({ collections: [collectionFixture({ id: "c2", name: "空空", items: ["yande:gone"] })] });
    renderWithProviders(<CollectionDetailHarness id="c2" fallbackName="空空" />);
    assert.ok(screen.getByText("合集是空的"), "全失配显示空态");
    assert.equal(screen.queryByRole("button", { name: "移出合集" }), null);
    assert.match(screen.getByText("0 张").textContent ?? "", /0 张/, "头部计数只数有效成员");
  });

  it("移出合集调 removeFromCollection：其余保序，存储不清洗未渲染的失配 key", () => {
    useSettings.setState({
      collections: [collectionFixture({ id: "c1", name: "風景", items: ["pixiv:1", "yande:gone", "pixiv:2"] })],
    });
    renderWithProviders(<CollectionDetailHarness id="c1" fallbackName="風景" />);
    const removes = screen.getAllByRole("button", { name: "移出合集" });
    fireEvent.click(removes[0] as HTMLButtonElement); // 第一张 = pixiv:1
    // 存储里的失配 key 原样保留（软失效口径：重新收藏自然恢复），只有点的那张被移除
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["yande:gone", "pixiv:2"]);
  });
});
