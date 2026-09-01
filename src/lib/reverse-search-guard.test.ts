import assert from "node:assert/strict";
import { test } from "node:test";
import {
  challengeMessage,
  fallbackSearchEngine,
  isBotChallenge,
  isSearchLimited,
  searchGapMs,
} from "./reverse-search-guard.ts";

test("SauceNAO with API key waits less", () => {
  assert.equal(searchGapMs("saucenao", false), 8_000);
  assert.equal(searchGapMs("saucenao", true), 2_500);
  assert.ok(searchGapMs("ascii2d") > searchGapMs("iqdb"));
});

test("falls back to IQDB except when already on IQDB", () => {
  assert.equal(fallbackSearchEngine("saucenao"), "iqdb");
  assert.equal(fallbackSearchEngine("ascii2d"), "iqdb");
  assert.equal(fallbackSearchEngine("iqdb"), "saucenao");
});

test("detects cloudflare and 429 as challenges", () => {
  assert.equal(isBotChallenge(429, "ok"), true);
  assert.equal(isBotChallenge(200, "<html>Just a moment...</html>"), true);
  assert.equal(isBotChallenge(200, "<div class=result>95%</div>"), false);
  assert.equal(isSearchLimited("ascii2d 触发了验证或限流"), true);
  assert.match(challengeMessage("ascii2d"), /IQDB/);
});
