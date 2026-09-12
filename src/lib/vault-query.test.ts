import assert from "node:assert/strict";
import { test } from "node:test";
import { filterVaultItems, vaultAuthors, vaultMonths, vaultTags, vaultTotals } from "./vault-query.ts";
import type { VaultMeta } from "./types.ts";

function item(over: Partial<VaultMeta> & Pick<VaultMeta, "key" | "title" | "author">): VaultMeta {
  return {
    source: "pixiv",
    id: over.id ?? over.key,
    authorId: "",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 100,
    ...over,
  };
}

test("filterVaultItems matches title author tags and folder path", () => {
  const rows = [
    item({ key: "pixiv:1", title: "Syring the Bikini", author: "_AGOTO", tags: ["Agoto", "OC"], relativePath: "Agoto/2026-08-31/syring.png" }),
    item({ key: "yande:9", source: "yande", title: "無題", author: "zero", tags: ["VOCALOID"], folderLabel: "插画" }),
  ];
  assert.equal(filterVaultItems(rows, { text: "bikini" }).length, 1);
  assert.equal(filterVaultItems(rows, { text: "agoto oc" }).length, 1);
  assert.equal(filterVaultItems(rows, { source: "yande" })[0]?.key, "yande:9");
  assert.equal(filterVaultItems(rows, { text: "vocaloid" }).length, 1);
  assert.equal(filterVaultItems(rows, { text: "2026-08-31" }).length, 1);
  assert.equal(filterVaultItems(rows, { author: "zero" }).length, 1);
  assert.equal(filterVaultItems(rows, { text: "missing" }).length, 0);
});

test("vaultAuthors and totals", () => {
  const rows = [
    item({ key: "a", title: "a", author: "zero", bytes: 10 }),
    item({ key: "b", title: "b", author: "zero", bytes: 15 }),
    item({ key: "c", title: "c", author: "_AGOTO", bytes: 5 }),
  ];
  assert.deepEqual(vaultAuthors(rows), ["_AGOTO", "zero"]);
  assert.deepEqual(vaultTotals(rows), { count: 3, bytes: 30 });
});

test("tags 任一命中；month 按 savedAt 本地年月；与既有谓词叠加（智能库）", () => {
  const rows = [
    item({ key: "a", title: "a", author: "zero", tags: ["landscape", "sky"], savedAt: new Date(2026, 7, 15).getTime() }),
    item({ key: "b", title: "b", author: "zero", tags: ["portrait"], savedAt: new Date(2026, 8, 2).getTime() }),
    item({ key: "c", title: "c", author: "_AGOTO", tags: ["sky"], savedAt: new Date(2025, 11, 30).getTime() }),
  ];
  assert.equal(filterVaultItems(rows, { tags: ["sky"] }).length, 2);
  assert.equal(filterVaultItems(rows, { tags: ["sky", "portrait"] }).length, 3); // 任一命中
  assert.equal(filterVaultItems(rows, { tags: ["nope"] }).length, 0);
  assert.equal(filterVaultItems(rows, { month: "2026-08" })[0]?.key, "a");
  assert.equal(filterVaultItems(rows, { month: "2026-09" })[0]?.key, "b");
  assert.equal(filterVaultItems(rows, { month: "2025-12" })[0]?.key, "c");
  assert.equal(filterVaultItems(rows, { author: "zero", tags: ["portrait"], month: "2026-09" })[0]?.key, "b");
  assert.equal(filterVaultItems(rows, { author: "_AGOTO", tags: ["portrait"] }).length, 0);
});

test("vaultTags 与 vaultMonths 派生选项列表", () => {
  const rows = [
    item({ key: "a", title: "a", author: "z", tags: ["sky", "sky", "night"], savedAt: new Date(2026, 7, 1).getTime() }),
    item({ key: "b", title: "b", author: "z", tags: ["sky"], savedAt: new Date(2026, 8, 1).getTime() }),
  ];
  assert.deepEqual(vaultTags(rows), ["sky", "night"]);
  assert.deepEqual(vaultMonths(rows), ["2026-09", "2026-08"]); // 新月在前
});
