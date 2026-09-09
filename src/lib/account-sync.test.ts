import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldApplyRemote } from "./account-sync.ts";

test("shouldApplyRemote 只在服务端更新时覆盖", () => {
  const marker = { userId: "u1", syncedAt: 1000 };
  // 服务端更旧 / 相同：不覆盖
  assert.equal(shouldApplyRemote(999, marker, "u1"), false);
  assert.equal(shouldApplyRemote(1000, marker, "u1"), false);
  // 服务端更新：覆盖
  assert.equal(shouldApplyRemote(1001, marker, "u1"), true);
  // 换了账号（marker 属于别人）：覆盖
  assert.equal(shouldApplyRemote(1, marker, "u2"), true);
  // 本地没有 marker（新浏览器）：覆盖
  assert.equal(shouldApplyRemote(1, null, "u1"), true);
  // 手动恢复：永远覆盖
  assert.equal(shouldApplyRemote(999, marker, "u1", true), true);
});
