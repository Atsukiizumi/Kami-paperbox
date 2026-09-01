import assert from "node:assert/strict";
import { test } from "node:test";
import { persistableQuery, trimDehydrated } from "./browse-cache.ts";

test("persistableQuery only keeps browse feeds", () => {
  assert.equal(persistableQuery({ queryKey: ["home-pixiv", "daily"] }), true);
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
            data: { pages: [1, 2, 3], pageParams: [1, 2, 3] },
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
  const data = state.queries[0]?.state.data as { pages: number[] };
  assert.deepEqual(data.pages, [1, 2]);
});
