import assert from "node:assert/strict";
import { test } from "node:test";
import { masonryColumns, masonrySpan, packJustified, packMasonry } from "./masonry-flow.ts";

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

test("packJustified fills a row with no leftover gap", () => {
  const packed = packJustified({
    containerWidth: 430,
    gap: 10,
    items: [{ aspect: 1 }, { aspect: 1 }, { aspect: 1 }, { aspect: 1 }],
    idealHeight: 100,
    minWidth: 40,
    captionBand: 0,
  });
  assert.equal(packed.placements.length, 4);
  assert.equal(packed.placements[0]?.y, 0);
  assert.equal(packed.placements[3]?.y, 0);
  const right =
    (packed.placements[3]?.x ?? 0) + (packed.placements[3]?.width ?? 0);
  assert.equal(right, 430);
  for (const p of packed.placements) {
    assert.equal(Math.round(p.height), 100);
  }
  assert.equal(packed.height, 100);
});

test("packJustified mixes portrait and landscape without a hole", () => {
  const packed = packJustified({
    containerWidth: 640,
    gap: 12,
    items: [
      { aspect: 0.6 },
      { aspect: 1.8 },
      { aspect: 0.75 },
      { aspect: 1.4 },
      { aspect: 0.5 },
      { aspect: 2.2 },
    ],
    idealHeight: 200,
    captionBand: 76,
  });
  assert.equal(packed.placements.length, 6);
  const rows = new Map<number, typeof packed.placements>();
  for (const p of packed.placements) {
    const key = Math.round(p.y);
    const list = rows.get(key) ?? [];
    list.push(p);
    rows.set(key, list);
  }
  for (const [y, row] of rows) {
    const heights = new Set(row.map((p) => Math.round(p.height)));
    assert.equal(heights.size, 1, `row at ${y} should share height`);
    const ordered = [...row].sort((a, b) => a.x - b.x);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const next = ordered[i]!;
      assert.ok(next.x + 0.5 >= prev.x + prev.width, "cards should not overlap");
    }
    const last = ordered[ordered.length - 1]!;
    if (ordered.length > 1) {
      assert.equal(Math.round(last.x + last.width), 640);
    }
  }
  assert.ok(packed.height > 200);
});

test("packJustified does not blow up a leftover last row", () => {
  const packed = packJustified({
    containerWidth: 800,
    gap: 12,
    items: [{ aspect: 0.75 }],
    idealHeight: 220,
    captionBand: 0,
  });
  const only = packed.placements[0];
  assert.ok(only);
  assert.ok(only.width >= 168);
  assert.ok(only.width < 400);
  assert.ok(only.height <= 400);
});

test("packJustified keeps portrait cards wide enough for a title", () => {
  const portraits = Array.from({ length: 8 }, () => ({ aspect: 0.62 }));
  const packed = packJustified({
    containerWidth: 960,
    gap: 12,
    items: portraits,
    idealHeight: 220,
    minWidth: 188,
    captionBand: 0,
  });
  for (const p of packed.placements) {
    assert.ok(p.width + 0.5 >= 188, `card width ${p.width} should be >= 188`);
  }
  const firstRow = packed.placements.filter((p) => p.y === 0);
  assert.ok(firstRow.length <= 4);
});

test("packJustified does not stretch a lone portrait across the row", () => {
  const packed = packJustified({
    containerWidth: 960,
    gap: 12,
    items: [
      { aspect: 3.1 },
      { aspect: 0.47 },
      { aspect: 1.1 },
      { aspect: 0.8 },
      { aspect: 1 },
      { aspect: 0.9 },
    ],
    idealHeight: 220,
    minWidth: 188,
    captionBand: 88,
  });
  const portrait = packed.placements[1];
  assert.ok(portrait);
  assert.ok(
    portrait.width < 480,
    `portrait width ${portrait.width} should not eat the row`,
  );
  assert.ok(portrait.width / portrait.height < 1.05);
});

test("packJustified lets a lone landscape keep the row", () => {
  const packed = packJustified({
    containerWidth: 960,
    gap: 12,
    items: [{ aspect: 16 / 9 }, { aspect: 0.5 }, { aspect: 0.55 }],
    idealHeight: 220,
    minWidth: 188,
    captionBand: 0,
  });
  const wide = packed.placements[0];
  assert.ok(wide);
  assert.ok(wide.width > 700, `landscape width ${wide.width} should stay wide`);
  assert.ok(wide.height >= 200);
  assert.ok(wide.height <= 480);
});
