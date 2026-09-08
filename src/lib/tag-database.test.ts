import assert from "node:assert/strict";
import { test } from "node:test";
import { TAG_DATABASE, databaseMap } from "./tag-database.ts";

test("ships a namespaced booru tag database", () => {
  assert.ok(TAG_DATABASE.length > 800);
  const miku = TAG_DATABASE.find((row) => row.en === "hatsune_miku");
  assert.equal(miku?.zh, "初音未来");
  assert.equal(miku?.ns, "character");
  assert.equal(databaseMap().get("thighhighs"), "过膝袜");
});
