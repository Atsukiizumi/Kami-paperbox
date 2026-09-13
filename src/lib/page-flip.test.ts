import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAGE_FLIP_LOCK_MS, PAGE_FLIP_MIN_DELTA, wheelDir, wrapPage } from "./page-flip.ts";

describe("滚轮切页纯逻辑（多 P 预览）", () => {
  it("方向：下滚下一页、上滚上一页", () => {
    assert.equal(wheelDir(100, 0, 1000), 1);
    assert.equal(wheelDir(-100, 0, 1000), -1);
  });

  it("阈值：触控板微动不翻页", () => {
    assert.equal(wheelDir(PAGE_FLIP_MIN_DELTA - 1, 0, 1000), 0);
    assert.equal(wheelDir(-(PAGE_FLIP_MIN_DELTA - 1), 0, 1000), 0);
    assert.equal(wheelDir(PAGE_FLIP_MIN_DELTA, 0, 1000), 1);
  });

  it("时间锁：惯性连发只翻一次", () => {
    const t = 1000;
    assert.equal(wheelDir(100, t, t + PAGE_FLIP_LOCK_MS - 1), 0);
    assert.equal(wheelDir(100, t, t + PAGE_FLIP_LOCK_MS), 1);
  });

  it("循环：末页下滚回首、首页上滚到末", () => {
    assert.equal(wrapPage(2, 1, 3), 0);
    assert.equal(wrapPage(0, -1, 3), 2);
    assert.equal(wrapPage(1, 1, 3), 2);
  });

  it("单页/零位移原样返回", () => {
    assert.equal(wrapPage(0, 1, 1), 0);
    assert.equal(wrapPage(0, 0, 5), 0);
  });
});
