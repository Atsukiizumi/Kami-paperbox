import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import { openVaultStore, parseVaultKey, rowToMeta, type VaultPageFile } from "./vault-store.server.ts";

test("parseVaultKey rejects traversal", () => {
  assert.deepEqual(parseVaultKey("pixiv:123"), { source: "pixiv", id: "123" });
  assert.equal(parseVaultKey("pixiv:../etc"), null);
  assert.equal(parseVaultKey("pixiv:.."), null);
  assert.equal(parseVaultKey("pixiv:."), null);
  assert.equal(parseVaultKey("pixiv:a.b"), null);
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
    assert.equal(store.get("pixiv:99")?.hasFile, true);
    assert.equal(store.list()[0]?.hasFile, true);
    assert.equal(store.remove("pixiv:99"), true);
    assert.equal(store.list().length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("putMeta restores a catalog row without replacing files", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-"));
  const store = openVaultStore(root);
  try {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    store.put(
      {
        key: "pixiv:99",
        source: "pixiv",
        id: "99",
        title: "old",
        author: "a",
        authorId: "1",
        tags: [],
        pageCount: 1,
        savedAt: 1,
        bytes: 0,
      },
      [{ bytes: png, ext: "png", mime: "image/png" }],
    );
    const metaOnly = store.putMeta({
      key: "yande:2",
      source: "yande",
      id: "2",
      title: "folder copy",
      author: "b",
      authorId: "",
      tags: ["landscape"],
      pageCount: 1,
      savedAt: 2,
      bytes: 8,
      relativePath: "b/2.jpg",
      folderLabel: "Kami",
    });
    assert.equal(metaOnly.id, "2");
    assert.equal(metaOnly.hasFile, false);
    assert.equal(store.list().length, 2);
    const kept = store.putMeta({
      key: "pixiv:99",
      source: "pixiv",
      id: "99",
      title: "renamed",
      author: "a",
      authorId: "1",
      tags: ["OC"],
      pageCount: 1,
      savedAt: 3,
      bytes: 0,
      relativePath: "a/99.png",
    });
    assert.equal(kept.title, "renamed");
    assert.equal(kept.hasFile, true);
    const page = store.readPage("pixiv:99", 0);
    assert.ok(page);
    assert.equal(page.ext, "png");
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

// ── TD-08 原子写 ─────────────────────────────────────────────────────────────

function pageOf(bytes: Uint8Array, ext = "jpg"): VaultPageFile {
  return { ext, mime: "image/jpeg", bytes };
}

test("put 中途写失败：旧文件与目录原样保留，无暂存残留", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-"));
  const store = openVaultStore(root);
  try {
    store.put({ key: "pixiv:77", source: "pixiv", id: "77", title: "旧", author: "", authorId: "", tags: [], pageCount: 0, savedAt: 1, bytes: 0 }, [
      pageOf(new Uint8Array([1, 2, 3])),
      pageOf(new Uint8Array([4, 5, 6])),
    ]);
    const before = store.get("pixiv:77");

    // 第二页 bytes 取值时抛错，模拟磁盘半路失败
    const poisoned = {
      ext: "jpg",
      mime: "image/jpeg",
      get bytes(): Uint8Array {
        throw new Error("disk full");
      },
    } as unknown as VaultPageFile;
    assert.throws(() =>
      store.put({ key: "pixiv:77", source: "pixiv", id: "77", title: "新", author: "", authorId: "", tags: [], pageCount: 0, savedAt: 2, bytes: 0 }, [
        pageOf(new Uint8Array([9])),
        poisoned,
      ]),
    );

    const after = store.get("pixiv:77");
    assert.equal(after?.title, before?.title, "目录行不该被改");
    assert.equal(after?.pageCount, 2, "页数不该被改");
    assert.deepEqual([...store.readPage("pixiv:77", 1)!.bytes], [4, 5, 6], "旧页面文件还在");
    const files = readdirSync(join(root, ".data", "vault", "files", "pixiv", "77"));
    assert.ok(files.every((f) => !f.endsWith(".tmp")), "暂存文件必须被清掉");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("put 成功后无暂存残留，且清掉上次崩溃的孤儿暂存", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-"));
  const store = openVaultStore(root);
  try {
    const workDir = join(root, ".data", "vault", "files", "pixiv", "88");
    store.put({ key: "pixiv:88", source: "pixiv", id: "88", title: "a", author: "", authorId: "", tags: [], pageCount: 0, savedAt: 1, bytes: 0 }, [pageOf(new Uint8Array([1]))]);
    // 手工放一个「崩溃残留」的暂存
    writeFileSync(join(workDir, ".0.jpg.tmp"), new Uint8Array([0]));

    store.put({ key: "pixiv:88", source: "pixiv", id: "88", title: "b", author: "", authorId: "", tags: [], pageCount: 0, savedAt: 2, bytes: 0 }, [
      pageOf(new Uint8Array([7, 7])),
      pageOf(new Uint8Array([8, 8]), "png"),
    ]);

    const files = readdirSync(workDir);
    assert.ok(files.every((f) => !f.endsWith(".tmp")), "孤儿暂存应被顺走");
    assert.deepEqual([...store.readPage("pixiv:88", 1)!.bytes], [8, 8], "新页面就位");
    assert.equal(store.get("pixiv:88")?.pageCount, 2);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("put 入库即算哈希；hashes/dismiss/storageBy/remove 清理", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-dh-"));
  const store = openVaultStore(root);
  try {
    // 真实 PNG（左半亮右半暗），保证解码成功
    const img = new PNG({ width: 32, height: 32 });
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (32 * y + x) << 2;
        const v = x < 16 ? 240 : 20;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    const png = new Uint8Array(PNG.sync.write(img));
    store.put(
      {
        key: "pixiv:9001",
        source: "pixiv",
        id: "9001",
        title: "t",
        author: "a",
        authorId: "a1",
        tags: ["x"],
        pageCount: 1,
        savedAt: 1_700_000_000_000,
        bytes: 0,
      },
      [{ bytes: png, ext: "png", mime: "image/png" }],
    );
    const hs = store.hashes();
    assert.equal(hs.length, 1);
    assert.equal(hs[0]!.key, "pixiv:9001");
    assert.match(hs[0]!.dhash, /^[0-9a-f]{16}$/);

    store.dismissPair("pixiv:9001", "danbooru:1");
    assert.equal(store.dismissedPairs().length, 1);
    // 同一对再 dismiss 幂等
    store.dismissPair("danbooru:1", "pixiv:9001");
    assert.equal(store.dismissedPairs().length, 1);

    const bySource = store.storageBy("source");
    assert.ok(bySource.some((g) => g.name === "pixiv" && g.count === 1 && g.bytes === png.byteLength));
    assert.ok(store.storageBy("author").some((g) => g.name === "a"));

    assert.equal(store.remove("pixiv:9001"), true);
    assert.equal(store.hashes().length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
