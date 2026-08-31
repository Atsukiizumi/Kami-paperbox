import assert from "node:assert/strict";
import { test } from "node:test";
import { masonryColumns, masonrySpan, packMasonry } from "./masonry-flow.ts";

test("masonryColumns follows container width", () => {
  assert.equal(masonryColumns(360, 12), 2);
  assert.equal(masonryColumns(600, 12), 3);
  assert.equal(masonryColumns(800, 12), 4);
  assert.equal(masonryColumns(976, 12), 5);
});

test("masonrySpan keeps landscape bigger without flushing the row", () => {
  assert.equal(masonrySpan("tile", 5), 1);
  assert.equal(masonrySpan("wide", 5), 2);
  assert.equal(masonrySpan("banner", 5), 3);
  assert.equal(masonrySpan("banner", 3), 2);
  assert.equal(masonrySpan("wide", 2), 2);
  assert.equal(masonrySpan("banner", 2), 2);
});

test("packMasonry fills the shortest column", () => {
  const packed = packMasonry({
    containerWidth: 320,
    columns: 3,
    gap: 10,
    items: [
      { span: 1, height: 100 },
      { span: 1, height: 40 },
      { span: 1, height: 40 },
      { span: 1, height: 40 },
    ],
  });
  assert.equal(packed.placements.length, 4);
  assert.deepEqual(
    packed.placements.map((p) => ({ x: p.x, y: p.y })),
    [
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 220, y: 0 },
      { x: 110, y: 50 },
    ],
  );
  assert.equal(packed.height, 100);
});

test("packMasonry sits a wide card next to leftover tiles", () => {
  const packed = packMasonry({
    containerWidth: 320,
    columns: 3,
    gap: 10,
    items: [
      { span: 2, height: 80 },
      { span: 1, height: 120 },
      { span: 1, height: 30 },
    ],
  });
  const [wide, tall, small] = packed.placements;
  assert.equal(wide?.x, 0);
  assert.equal(wide?.y, 0);
  assert.ok((wide?.width ?? 0) > 180);
  assert.equal(tall?.y, 0);
  assert.equal(small?.y, 90);
  assert.equal(small?.x, 0);
  assert.equal(packed.height, 120);
});
