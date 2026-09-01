import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaGateActive, withMediaGate } from "./media-gate.ts";

test("withMediaGate keeps at most 6 tasks in flight", async () => {
  let peak = 0;
  const jobs = Array.from({ length: 12 }, () =>
    withMediaGate(async () => {
      peak = Math.max(peak, mediaGateActive());
      await new Promise((r) => setTimeout(r, 20));
    }),
  );
  await Promise.all(jobs);
  assert.ok(peak <= 6, `peak ${peak}`);
  assert.equal(mediaGateActive(), 0);
});
