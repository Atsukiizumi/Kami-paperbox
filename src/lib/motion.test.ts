import assert from "node:assert/strict";
import { test } from "node:test";
import { flipTransform } from "./motion.ts";

test("flipTransform maps a half-size card onto the preview", () => {
  assert.deepEqual(
    flipTransform(
      { left: 10, top: 20, width: 100, height: 50 },
      { left: 10, top: 20, width: 200, height: 100 },
    ),
    { dx: 0, dy: 0, sx: 0.5, sy: 0.5 },
  );
});

test("flipTransform shifts when the preview sits to the right", () => {
  const t = flipTransform(
    { left: 0, top: 0, width: 80, height: 80 },
    { left: 100, top: 10, width: 160, height: 160 },
  );
  assert.equal(t.dx, -100);
  assert.equal(t.dy, -10);
  assert.equal(t.sx, 0.5);
  assert.equal(t.sy, 0.5);
});
