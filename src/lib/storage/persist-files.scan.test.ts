import assert from "node:assert/strict";
import { test } from "node:test";
import { folderScanUpdate } from "./persist-files.ts";

const sha = "ab".repeat(32);

test("文件不在：第一次写入标记并计数，再扫一次仍然计数", () => {
  const first = folderScanUpdate(false, { missing: true }, sha);
  assert.deepEqual(first, { replaced: true, count: true, write: true });
  const again = folderScanUpdate(true, { missing: true }, sha);
  assert.equal(again.count, true, "已经标过的缺失原图再扫仍算被替换");
  assert.equal(again.write, false, "标记不用再写一遍");
  assert.equal(again.replaced, true);
});

test("哈希不一致才计数；对上了就清标记", () => {
  const other = "cd".repeat(32);
  const bad = folderScanUpdate(true, { sha256: other }, sha);
  assert.deepEqual(bad, { replaced: true, count: true, write: false });
  const fresh = folderScanUpdate(false, { sha256: other }, sha);
  assert.deepEqual(fresh, { replaced: true, count: true, write: true });
  const healed = folderScanUpdate(true, { sha256: sha }, sha);
  assert.deepEqual(healed, { replaced: false, count: false, write: true });
  const ok = folderScanUpdate(false, { sha256: sha }, sha);
  assert.deepEqual(ok, { replaced: false, count: false, write: false });
});
