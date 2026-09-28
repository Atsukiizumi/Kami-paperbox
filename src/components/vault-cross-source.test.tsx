/**
 * VaultCrossSource RTL（M1 视图，样板 collections-bar.test.tsx）。
 *
 * 作用：锁簇块头（张数/最远距离/站点列表）、成员注释行（站点 · 体积 · 页数）、
 *       忽略整簇发 C(n,2) 次两两 dismiss、删除成员走 onDeleteMember 且簇降到
 *       单源后整簇消失（降级口径）。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactElement } from "react";
import type { CrossSourceCluster } from "@/lib/storage/vault-cross-source";
import type { VaultMeta } from "@/lib/types";
import { VaultCrossSource } from "./vault-cross-source.tsx";

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

// useVaultCover 的封面链在 jsdom 没有 IndexedDB：open 桩的回调永不触发（不产生 unhandled rejection）。
{
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.indexedDB === undefined) g.indexedDB = { open: () => ({}) };
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

function meta(key: string, pageCount = 1): VaultMeta {
  const cut = key.indexOf(":");
  return {
    key,
    source: key.slice(0, cut) as VaultMeta["source"],
    id: key.slice(cut + 1),
    title: `t-${key}`,
    author: "画师",
    authorId: "1",
    tags: [],
    pageCount,
    savedAt: 1,
    bytes: 0,
  };
}

const ITEMS = [meta("pixiv:1"), meta("pixiv:2", 2), meta("yande:1")];
const CLUSTER: CrossSourceCluster = {
  keys: ["pixiv:1", "pixiv:2", "yande:1"],
  sources: ["pixiv", "yande"],
  maxDistance: 8,
};

describe("VaultCrossSource（同图多源视图）", () => {
  beforeEach(() => cleanup());

  it("渲染簇块头（张数/距离/站点）与成员注释行（站点 · 体积 · 页数）", () => {
    renderWithProviders(
      <VaultCrossSource
        items={ITEMS}
        clusters={[CLUSTER]}
        hashed={2}
        total={3}
        tagAliases={{}}
        onReload={() => undefined}
        onDeleteMember={() => undefined}
        onBack={() => undefined}
      />,
    );
    assert.match(
      screen.getByText(/跨源同图 · 3 张 · 最远距离 8 · Pixiv \/ Yande/).textContent ?? "",
      /跨源同图 · 3 张 · 最远距离 8 · Pixiv \/ Yande/,
    );
    const captions = screen.getAllByTestId("cross-member-caption");
    assert.deepEqual(
      captions.map((c) => c.textContent),
      ["Pixiv · 0 B", "Pixiv · 0 B · 2P", "Yande · 0 B"],
    );
    assert.match(screen.getByTestId("cross-coverage").textContent ?? "", /哈希覆盖 2\/3——先去「查重」里扫描补齐/);
  });

  it("忽略整簇：两两 dismiss 共 C(3,2)=3 次请求，随后 onReload", async () => {
    const calls: { a: string; b: string }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as { a: string; b: string });
      return { ok: true } as Response;
    }) as typeof fetch;
    let reloaded = 0;
    try {
      renderWithProviders(
        <VaultCrossSource
          items={ITEMS}
          clusters={[CLUSTER]}
          hashed={3}
          total={3}
          tagAliases={{}}
          onReload={() => {
            reloaded += 1;
          }}
          onDeleteMember={() => undefined}
          onBack={() => undefined}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "都保留（忽略）" }));
      await waitFor(() => assert.equal(calls.length, 3, "两两 pair 各发一次 dismiss"));
      const expected = new Set(["pixiv:1|pixiv:2", "pixiv:1|yande:1", "pixiv:2|yande:1"]);
      for (const call of calls) assert.ok(expected.has(`${call.a}|${call.b}`), `意外的 dismiss 对 ${call.a}|${call.b}`);
      await waitFor(() => assert.equal(reloaded, 1));
      assert.ok(screen.getByText(/没有发现跨源同图/), "乐观去簇后视图清空");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("删除成员走 onDeleteMember；簇降到单源整簇消失（归查重管）", () => {
    const removed: string[] = [];
    renderWithProviders(
      <VaultCrossSource
        items={ITEMS}
        clusters={[CLUSTER]}
        hashed={3}
        total={3}
        tagAliases={{}}
        onReload={() => undefined}
        onDeleteMember={(item) => {
          removed.push(item.key);
        }}
        onBack={() => undefined}
      />,
    );
    // 注释行顺序 = keys 顺序；第三条是唯一跨源成员 yande:1——删它簇即降级
    const captions = screen.getAllByTestId("cross-member-caption");
    assert.match(captions[2]!.textContent ?? "", /Yande · 0 B/);
    const memberWrapper = captions[2]!.parentElement!;
    const tray = memberWrapper.querySelector('[aria-label="从纸匣移除"]') as HTMLButtonElement;
    assert.ok(tray, "vault 托的移除钮可定位");
    fireEvent.click(tray);
    assert.deepEqual(removed, ["yande:1"]);
    assert.ok(screen.getByText(/没有发现跨源同图/), "单源簇从跨源视图消失");
  });

  it("空簇列表 + 覆盖齐平：无引导句", () => {
    renderWithProviders(
      <VaultCrossSource
        items={ITEMS}
        clusters={[]}
        hashed={3}
        total={3}
        tagAliases={{}}
        onReload={() => undefined}
        onDeleteMember={() => undefined}
        onBack={() => undefined}
      />,
    );
    assert.ok(screen.getByText(/没有发现跨源同图/));
    assert.equal(screen.getByTestId("cross-coverage").textContent, "哈希覆盖 3/3");
  });
});
