import assert from "node:assert/strict";
import { test } from "node:test";
import { cardAspect, FALLBACK_ASPECT, MAX_ASPECT, MIN_ASPECT } from "./card-aspect.ts";

test("cardAspect falls back when size is missing", () => {
  assert.equal(cardAspect(), FALLBACK_ASPECT);
  assert.equal(cardAspect(0, 100), FALLBACK_ASPECT);
  assert.equal(cardAspect(100, 0), FALLBACK_ASPECT);
  assert.equal(cardAspect(-1, 10), FALLBACK_ASPECT);
});

test("cardAspect keeps native ratio and clamps extremes", () => {
  assert.equal(cardAspect(1200, 1600), 0.75);
  assert.equal(cardAspect(1600, 900), 1600 / 900);
  assert.equal(cardAspect(4000, 1000), MAX_ASPECT);
  assert.equal(cardAspect(400, 2000), MIN_ASPECT);
});
