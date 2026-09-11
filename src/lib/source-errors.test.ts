import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySourceError } from "./source-errors.ts";
import { UpstreamError } from "./upstream/http.ts";

test("UpstreamError maps to 502 upstream", () => {
  const r = classifySourceError(new UpstreamError("Yande 请求失败（503）"));
  assert.equal(r.status, 502);
  assert.equal(r.kind, "upstream");
  assert.equal(r.message, "Yande 请求失败（503）");
});

test("plain user-facing errors map to 400 bad-request", () => {
  const r = classifySourceError(new Error("需要登录 Pixiv 才能查看该榜单。"));
  assert.equal(r.status, 400);
  assert.equal(r.kind, "bad-request");
});

test("non-Error / empty message falls back to generic message and 400", () => {
  const r = classifySourceError("boom");
  assert.equal(r.status, 400);
  assert.equal(r.message, "请求失败");
});
