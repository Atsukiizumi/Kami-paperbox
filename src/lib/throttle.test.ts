import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THROTTLE, parseThrottle } from "./throttle.ts";

test("parseThrottle fills defaults when throttle is missing", () => {
  assert.deepEqual(parseThrottle({ host: "0.0.0.0" }), DEFAULT_THROTTLE);
});

test("parseThrottle clamps mediaConcurrency", () => {
  assert.equal(parseThrottle({ throttle: { mediaConcurrency: 100 } }).mediaConcurrency, 32);
  assert.equal(parseThrottle({ throttle: { mediaConcurrency: 0 } }).mediaConcurrency, 1);
  assert.equal(parseThrottle({ throttle: { mediaConcurrency: 3 } }).mediaConcurrency, 3);
});

test("parseThrottle reads search gaps", () => {
  const t = parseThrottle({ throttle: { search: { ascii2d: 20000, saucenao: 1000 } } });
  assert.equal(t.search.ascii2d, 20_000);
  assert.equal(t.search.saucenao, 1_000);
  assert.equal(t.search.iqdb, DEFAULT_THROTTLE.search.iqdb);
});
