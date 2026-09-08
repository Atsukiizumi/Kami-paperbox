import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TAG_CATALOG_MAX, mergeCatalog, splitBooruTokens } from "./tag-catalog.ts";

describe("tag catalog", () => {
  it("splits booru tokens and ignores empties", () => {
    assert.deepEqual(splitBooruTokens(["hatsune_miku sky", " sky "]), ["hatsune_miku", "sky"]);
  });

  it("counts repeats and records sites", () => {
    const once = mergeCatalog([], "yande", ["sky", "wet"], 1);
    const twice = mergeCatalog(once, "konachan", ["sky"], 2);
    const sky = twice.find((row) => row.en === "sky");
    assert.equal(sky?.count, 2);
    assert.deepEqual(sky?.sites, ["yande", "konachan"]);
    assert.equal(twice.find((row) => row.en === "wet")?.sites[0], "yande");
  });

  it("ignores pixiv", () => {
    assert.equal(mergeCatalog([], "pixiv", ["初音ミク"]).length, 0);
  });

  it("caps the warehouse", () => {
    const seed = Array.from({ length: TAG_CATALOG_MAX }, (_, i) => ({
      en: `tag_${i}`,
      count: 1,
      lastSeen: i,
      sites: ["yande" as const],
    }));
    const next = mergeCatalog(seed, "yande", ["brand_new"], TAG_CATALOG_MAX + 1);
    assert.equal(next.length, TAG_CATALOG_MAX);
    assert.ok(next.some((row) => row.en === "brand_new"));
  });
});
