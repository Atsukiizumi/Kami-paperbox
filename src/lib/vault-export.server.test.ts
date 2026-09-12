import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import { openVaultStore } from "./vault-store.server.ts";
import type { VaultMeta } from "./types.ts";
import { buildExportEntries, entryName } from "./vault-export.server.ts";

function png24(): Uint8Array {
  const img = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < 16 * 16; i++) {
    img.data[i * 4] = i % 256;
    img.data[i * 4 + 3] = 255;
  }
  return new Uint8Array(PNG.sync.write(img));
}

function meta(key: string, over: Partial<{ author: string; title: string; pageCount: number }>): VaultMeta {
  const [source, id] = key.split(":");
  return {
    key,
    source: source as VaultMeta["source"],
    id,
    title: over.title ?? `t${id}`,
    author: over.author ?? "artistA",
    authorId: "1",
    tags: [],
    pageCount: over.pageCount ?? 1,
    savedAt: 1_700_000_000_000,
    bytes: 0,
    hasFile: true,
  };
}

test("entryName：按作者分文件夹 + 清洗 + 页码", () => {
  assert.equal(entryName({ author: "Zero/悪", title: "Sea Sky", source: "pixiv", id: "1" }, 0, "png"), "Zero_/Sea_Sky_pixiv_1_p0.png");
  assert.equal(entryName({ author: "", title: "", source: "danbooru", id: "x-9" }, 2, "jpeg"), "unknown/x-9_danbooru_x-9_p2.jpeg");
});

test("buildExportEntries：有文件打包、缺文件跳过分组", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-exp-"));
  const store = openVaultStore(root);
  try {
    const png = png24();
    store.put(meta("pixiv:101", {}), [{ bytes: png, ext: "png", mime: "image/png" }]);
    store.put(meta("pixiv:102", { author: "artistB", pageCount: 2 }), [
      { bytes: png, ext: "png", mime: "image/png" },
      { bytes: png, ext: "png", mime: "image/png" },
    ]);
    // put 需要至少 1 页；目录行页数>0 但磁盘无文件 = read-error
    store.putMeta(meta("pixiv:104", {}));
    const { entries, skipped } = buildExportEntries(store, ["pixiv:101", "pixiv:102", "pixiv:104", "pixiv:999"]);
    assert.equal(entries.length, 3);
    assert.ok(entries.every((e) => e.name.includes("/")));
    assert.deepEqual(skipped, [
      { key: "pixiv:104", reason: "read-error" },
      { key: "pixiv:999", reason: "missing" },
    ]);
    assert.ok(entries[0]!.bytes.byteLength > 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
