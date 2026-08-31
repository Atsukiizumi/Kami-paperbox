import assert from "node:assert/strict";
import { test } from "node:test";
import { filterVaultItems, vaultAuthors, vaultTotals } from "./vault-query.ts";
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
