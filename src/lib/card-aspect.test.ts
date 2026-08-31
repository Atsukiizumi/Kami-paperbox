import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardAspect,
  cardLayout,
  FALLBACK_ASPECT,
  MAX_PANORAMA_ASPECT,
  MIN_ASPECT,
} from "./card-aspect.ts";

test("cardAspect falls back when size is missing", () => {
  assert.equal(cardAspect(), FALLBACK_ASPECT);
  assert.equal(cardAspect(0, 100), FALLBACK_ASPECT);
  assert.equal(cardAspect(100, 0), FALLBACK_ASPECT);
  assert.equal(cardAspect(-1, 10), FALLBACK_ASPECT);
});

test("cardAspect keeps native ratio and clamps extremes", () => {
  assert.equal(cardAspect(1200, 1600), 0.75);
  assert.equal(cardAspect(1600, 900), 1600 / 900);
  assert.equal(cardAspect(2200, 1000), 2.2);
  assert.equal(cardAspect(4000, 1000), MAX_PANORAMA_ASPECT);
  assert.equal(cardAspect(400, 2000), MIN_ASPECT);
  assert.equal(cardAspect(1200, 1200), 1);
});

test("cardLayout sends landscape across columns", () => {
  assert.equal(cardLayout(), "tile");
  assert.equal(cardLayout(1200, 1600), "tile");
  assert.equal(cardLayout(1200, 1200), "tile");
  assert.equal(cardLayout(1250, 1000), "tile");
  assert.equal(cardLayout(1600, 1200), "wide");
  assert.equal(cardLayout(1600, 900), "wide");
  assert.equal(cardLayout(4000, 2000), "banner");
  assert.equal(cardLayout(4000, 1000), "banner");
});
