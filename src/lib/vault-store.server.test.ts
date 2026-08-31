import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openVaultStore, parseVaultKey, rowToMeta } from "./vault-store.server.ts";

test("parseVaultKey rejects traversal", () => {
  assert.deepEqual(parseVaultKey("pixiv:123"), { source: "pixiv", id: "123" });
  assert.equal(parseVaultKey("pixiv:../etc"), null);
  assert.equal(parseVaultKey("nope:1"), null);
});

test("openVaultStore put list search and read page", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-"));
  const store = openVaultStore(root);
  try {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const saved = store.put(
      {
        key: "pixiv:99",
        source: "pixiv",
        id: "99",
        title: "Syring the Bikini",
        author: "_AGOTO",
        authorId: "1",
        tags: ["Agoto", "OC"],
        pageCount: 1,
        savedAt: 1_700_000_000_000,
        bytes: 0,
      },
      [{ bytes: png, ext: "png", mime: "image/png" }],
    );
    assert.equal(saved.bytes, png.byteLength);
    assert.equal(store.list().length, 1);
    assert.equal(store.list({ text: "bikini" })[0]?.id, "99");
    assert.equal(store.list({ text: "missing" }).length, 0);
    assert.equal(store.list({ author: "_AGOTO" }).length, 1);
    const page = store.readPage("pixiv:99", 0);
    assert.ok(page);
    assert.equal(page.ext, "png");
    assert.deepEqual(Uint8Array.from(page.bytes), png);
    store.patch("pixiv:99", { relativePath: "Agoto/syring.png" });
    assert.equal(store.get("pixiv:99")?.relativePath, "Agoto/syring.png");
    assert.equal(store.remove("pixiv:99"), true);
    assert.equal(store.list().length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rowToMeta reads tags json", () => {
  const meta = rowToMeta({
    key: "yande:1",
    source: "yande",
    id: "1",
    title: "無題",
    author: "zero",
    author_id: "",
    tags: '["VOCALOID"]',
    page_count: 1,
    saved_at: 2,
    bytes: 3,
    relative_path: null,
    folder_label: null,
  });
  assert.deepEqual(meta.tags, ["VOCALOID"]);
  assert.equal(meta.relativePath, undefined);
});
