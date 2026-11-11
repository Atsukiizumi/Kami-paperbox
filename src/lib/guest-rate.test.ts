import assert from "node:assert/strict";
import { test } from "node:test";
import { allowGuest, resetGuestRatesForTests } from "./guest-rate.ts";

test("同一窗口内超过上限拒绝，窗口过后重新计数", () => {
  resetGuestRatesForTests();
  assert.equal(allowGuest("media", 2, 1_000, 60_000), true);
  assert.equal(allowGuest("media", 2, 1_000, 60_000), true);
  assert.equal(allowGuest("media", 2, 1_500, 60_000), false);
  assert.equal(allowGuest("source", 1, 1_500, 60_000), true, "分桶互不影响");
  assert.equal(allowGuest("media", 2, 61_000, 60_000), true);
  resetGuestRatesForTests();
});
