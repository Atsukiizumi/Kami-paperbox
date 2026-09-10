import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { hydrateBrowseCache, persistableQuery, trimDehydrated } from "./browse-cache.ts";

test("persistableQuery only keeps browse feeds", () => {
  assert.equal(persistableQuery({ queryKey: ["home-pixiv", "daily"] }), true);
  assert.equal(persistableQuery({ queryKey: ["home-pixiv", "recommend"] }), true);
  assert.equal(persistableQuery({ queryKey: ["home-pixiv", "following"] }), true);
  assert.equal(persistableQuery({ queryKey: ["home-fanbox"] }), true);
  assert.equal(persistableQuery({ queryKey: ["home-booru"] }), true);
  assert.equal(persistableQuery({ queryKey: ["work", "pixiv", "1"] }), false);
  assert.equal(persistableQuery({ queryKey: ["tag-suggest"] }), false);
});

test("trimDehydrated drops stale queries and extra pages", () => {
  const now = 1_000_000;
  const state = trimDehydrated(
    {
      queries: [
        {
          queryHash: "a",
          queryKey: ["home-pixiv", "daily"],
          state: {
            data: {
              pages: [
                { items: Array.from({ length: 30 }, (_, i) => i) },
                { items: Array.from({ length: 30 }, (_, i) => i) },
                { items: Array.from({ length: 30 }, (_, i) => i) },
              ],
              pageParams: [1, 2, 3],
            },
            dataUpdatedAt: now - 1000,
            status: "success",
          },
        },
        {
          queryHash: "b",
          queryKey: ["home-pixiv", "weekly"],
          state: { data: { pages: [1] }, dataUpdatedAt: now - 25 * 60 * 60_000, status: "success" },
        },
        {
          queryHash: "c",
          queryKey: ["work", "pixiv", "1"],
          state: { data: {}, dataUpdatedAt: now, status: "success" },
        },
      ],
    } as never,
    now,
  );
  assert.equal(state.queries.length, 1);
  const data = state.queries[0]?.state.data as { pages: { items: number[] }[]; pageParams: number[] };
  assert.equal(data.pages.length, 2);
  assert.deepEqual(data.pageParams, [1, 2]);
});

test("trimDehydrated keeps enough FANBOX pages to fill one screen", () => {
  const now = 1_000_000;
  const pages = Array.from({ length: 8 }, (_, i) => ({
    op: "fanboxHome",
    items: Array.from({ length: 10 }, (_, j) => j + i * 10),
    cursor: { datetime: "t", id: String(i) },
  }));
  const state = trimDehydrated(
    {
      queries: [
        {
          queryHash: "fanbox",
          queryKey: ["home-fanbox", "home"],
          state: {
            data: { pages, pageParams: pages.map((_, i) => i) },
            dataUpdatedAt: now,
            status: "success",
          },
        },
      ],
    } as never,
    now,
  );
  const data = state.queries[0]?.state.data as { pages: { items: number[] }[] };
  assert.equal(data.pages.length, 5);
  assert.equal(data.pages.reduce((n, p) => n + p.items.length, 0), 50);
});

test("hydrateBrowseCache paints localStorage before any fetch", () => {
  const mem = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, String(v)),
      removeItem: (k: string) => mem.delete(k),
    },
  });
  try {
    // 顺手放一份 v1 残留：hydrate 后应被清除（SEC-04 弃用带 Cookie 原文的旧存储）
    mem.set("kami-browse-v1", JSON.stringify({ queries: [] }));
    mem.set(
      "kami-browse-v2",
      JSON.stringify({
        queries: [
          {
            queryHash: '["home-fanbox","home"]',
            queryKey: ["home-fanbox", "home"],
            state: {
              data: { pages: [{ op: "fanboxHome", items: [{ id: "1" }], cursor: null }], pageParams: [undefined] },
              dataUpdatedAt: Date.now(),
              status: "success",
            },
          },
          {
            queryHash: '["home-pixiv","recommend"]',
            queryKey: ["home-pixiv", "recommend"],
            state: {
              data: { pages: [{ op: "pixivRecommend", items: [{ id: "2" }], nextPage: null }], pageParams: [1] },
              dataUpdatedAt: Date.now(),
              status: "success",
            },
          },
        ],
      }),
    );
    const client = new QueryClient();
    hydrateBrowseCache(client);
    const fanbox = client.getQueryData(["home-fanbox", "home"]) as { pages: { op: string }[] };
    const rec = client.getQueryData(["home-pixiv", "recommend"]) as { pages: { op: string }[] };
    assert.equal(fanbox.pages[0]?.op, "fanboxHome");
    assert.equal(rec.pages[0]?.op, "pixivRecommend");
    assert.equal(mem.has("kami-browse-v1"), false, "旧 v1 存储应被删除");
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
    }
  }
});

test("hydrateBrowseCache skips stale queries that have no observer", async () => {
  const mem = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, String(v)),
      removeItem: (k: string) => mem.delete(k),
    },
  });
  try {
    const key = ["home-pixiv", "daily", "", {}, true, false, "", "2026-09-09"];
    mem.set(
      "kami-browse-v2",
      JSON.stringify({
        queries: [
          {
            queryHash: JSON.stringify(key),
            queryKey: key,
            state: {
              data: { pages: [{ op: "pixivRanking", items: [], nextPage: null }], pageParams: [1] },
              dataUpdatedAt: Date.now() - 2 * 60 * 60 * 1000,
              status: "success",
            },
          },
        ],
      }),
    );
    const client = new QueryClient();
    hydrateBrowseCache(client);
    await new Promise((r) => setTimeout(r, 50));
    // 没挂观察者的键没有 queryFn；刷新循环要是 fetch 它，状态会变成 error（Missing queryFn）
    const state = client.getQueryState(key);
    assert.equal(state?.status, "success");
    assert.equal(state?.fetchStatus, "idle");
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
    }
  }
});
