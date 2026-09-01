import assert from "node:assert/strict";
import { test } from "node:test";
import { flipMatrix, flipProgress, flipTransform, IDENTITY_MATRIX } from "./motion.ts";

const from = { left: 0, top: 0, width: 80, height: 80 };
const to = { left: 100, top: 10, width: 160, height: 160 };

test("flipTransform maps a half-size card onto the preview", () => {
  assert.deepEqual(
    flipTransform(
      { left: 10, top: 20, width: 100, height: 50 },
      { left: 10, top: 20, width: 200, height: 100 },
    ),
    { dx: 0, dy: 0, sx: 0.5, sy: 0.5 },
  );
});

test("flipMatrix is origin-0-0 scale then translate", () => {
  assert.equal(flipMatrix(from, to), "matrix(0.5, 0, 0, 0.5, -100, -10)");
  assert.equal(IDENTITY_MATRIX, "matrix(1, 0, 0, 1, 0, 0)");
});

test("flipProgress is 0 at First and 1 at Last", () => {
  assert.equal(flipProgress(from, to, from), 0);
  assert.equal(flipProgress(from, to, to), 1);
});

test("flipProgress is halfway when visual sits in the middle", () => {
  const mid = { left: 50, top: 5, width: 120, height: 120 };
  const p = flipProgress(from, to, mid);
  assert.ok(p > 0.45 && p < 0.55, `got ${p}`);
});
