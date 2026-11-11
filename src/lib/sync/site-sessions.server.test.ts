import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  SiteSessionsCorruptError,
  deleteAccountSecrets,
  emptySiteSecrets,
  mergeSiteSecrets,
  readAccountSecrets,
  writeAccountSecrets,
} from "./site-sessions.server.ts";

test("账号凭据加密落盘，缺字段合并不把别的站清掉", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-sessions-"));
  try {
    assert.equal(readAccountSecrets("a", root), null);
    writeAccountSecrets("a", { ...emptySiteSecrets(), pixiv: "11111111_token" }, root);
    writeAccountSecrets(
      "a",
      mergeSiteSecrets(readAccountSecrets("a", root) ?? emptySiteSecrets(), { x: "auth_token=aa; ct0=bb" }),
      root,
    );
    const saved = readAccountSecrets("a", root);
    assert.equal(saved?.pixiv, "11111111_token");
    assert.equal(saved?.x, "auth_token=aa; ct0=bb");
    assert.equal(saved?.fanbox, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("存储解不开时读 fail-closed，写按重置继续", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-sessions-corrupt-"));
  try {
    writeAccountSecrets("a", { ...emptySiteSecrets(), pixiv: "11111111_token" }, root);
    // 密钥文件被重建（丢失 / 损坏）→ 旧密文必解不开：读必须抛而不是当空
    //（当空会让下一次写把其余账号静默盖掉）
    rmSync(join(root, ".data", "site-sessions.key"));
    assert.throws(() => readAccountSecrets("a", root), SiteSessionsCorruptError);
    // 写不死锁：重置后新条目可写可读
    writeAccountSecrets("b", { ...emptySiteSecrets(), x: "auth_token=aa; ct0=bb" }, root);
    assert.equal(readAccountSecrets("b", root)?.x, "auth_token=aa; ct0=bb");
    assert.equal(readAccountSecrets("a", root), null, "重置后旧账号如实不可读");
    // 删除在损坏态下等价于整体重置，不再抛
    deleteAccountSecrets("b", root);
    assert.equal(readAccountSecrets("b", root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
