import assert from "node:assert/strict";
import { test } from "node:test";
import { createSemaphore } from "./semaphore.ts";

test("并发上限与 FIFO 排队；release 后唤醒等待者", async () => {
  const gate = createSemaphore(2);
  const order: string[] = [];
  const r1 = await gate.acquire();
  const r2 = await gate.acquire();
  assert.equal(gate.active(), 2);
  const p3 = gate.acquire().then((r) => {
    order.push("3");
    return r;
  });
  const p4 = gate.acquire().then((r) => {
    order.push("4");
    return r;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gate.active(), 2, "超限排队不放行");
  assert.deepEqual(order, []);
  r1();
  await p3;
  assert.equal(gate.active(), 2);
  r2();
  await p4;

  assert.deepEqual(order, ["3", "4"], "FIFO 唤醒");
});

test("limit<1 夹到 1（串行）", async () => {
  const gate = createSemaphore(0);
  const r = await gate.acquire();
  let second = false;
  void gate.acquire().then(() => {
    second = true;
  });
  await new Promise((r2) => setTimeout(r2, 10));
  assert.equal(second, false);
  r();
  await new Promise((r2) => setTimeout(r2, 10));
  assert.equal(second, true);
});
