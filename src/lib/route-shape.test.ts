import assert from "node:assert/strict";
import { test } from "node:test";
import { isBrowsePath, isDeskPath, isMainNavPath, navItemActive } from "./route-shape.ts";

test("isDeskPath / isBrowsePath", () => {
  assert.equal(isDeskPath("/"), true);
  assert.equal(isDeskPath("/browse"), false);
  assert.equal(isBrowsePath("/browse"), true);
  assert.equal(isBrowsePath("/browse/"), false);
  assert.equal(isBrowsePath("/"), false);
});

test("案头与浏览都不算 isMainNavPath（保活不被卸）", () => {
  assert.equal(isMainNavPath("/"), false);
  assert.equal(isMainNavPath("/browse"), false);
  assert.equal(isMainNavPath("/watch"), false);
  assert.equal(isMainNavPath("/vault"), true);
  assert.equal(isMainNavPath("/rankings"), true);
});

test("navItemActive：案头只亮自己", () => {
  assert.equal(navItemActive("/", "/"), true);
  assert.equal(navItemActive("/browse", "/"), false);
  assert.equal(navItemActive("/work/pixiv/1", "/"), false);
});

test("navItemActive：浏览亮网格和作品/画师/创作者，不亮合集", () => {
  assert.equal(navItemActive("/browse", "/browse"), true);
  assert.equal(navItemActive("/work/yande/1", "/browse"), true);
  assert.equal(navItemActive("/user/2", "/browse"), true);
  assert.equal(navItemActive("/creator/3", "/browse"), true);
  assert.equal(navItemActive("/pool/yande/4", "/browse"), false);
  assert.equal(navItemActive("/", "/browse"), false);
});

test("navItemActive：其它项前缀", () => {
  assert.equal(navItemActive("/vault", "/vault"), true);
  assert.equal(navItemActive("/vault/stats", "/vault"), true);
  assert.equal(navItemActive("/settings", "/vault"), false);
});
