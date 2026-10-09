import assert from "node:assert/strict";
import { test } from "node:test";
import { browseGridLoading } from "./browse-grid.ts";

const idle = {
  settingsReady: true,
  refreshing: false,
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
  itemCount: 0,
};

test("翻页拉取时这一页还是空的，仍画骨架", () => {
  assert.equal(
    browseGridLoading({ ...idle, isFetching: true, isFetchingNextPage: true, itemCount: 0 }),
    true,
  );
  assert.equal(
    browseGridLoading({ ...idle, isFetching: false, isFetchingNextPage: true, itemCount: 0 }),
    true,
  );
});

test("这一页已经有卡片时，后台拉下一页不换成骨架", () => {
  assert.equal(
    browseGridLoading({ ...idle, isFetching: true, isFetchingNextPage: true, itemCount: 50 }),
    false,
  );
});

test("拉完了仍然一张都没有，才留给空状态", () => {
  assert.equal(browseGridLoading(idle), false);
});
