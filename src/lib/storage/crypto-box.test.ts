import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveBoxKey, openJson, randomSaltB64, sealJson, type CipherBox } from "./crypto-box.ts";

test("crypto-box：往返一致；错口令失败；salt 独立", async () => {
  const salt = randomSaltB64();
  const key = await deriveBoxKey("correct horse", salt);
  const box = await sealJson(key, { secret: "PHPSESSID=xyz", n: 1 }, salt);
  assert.equal(box.v, 1);
  assert.equal(box.kdf, "PBKDF2-SHA256");

  const opened = await openJson<{ secret: string; n: number }>(await deriveBoxKey("correct horse", box.salt, box.iter), box);
  assert.deepEqual(opened, { secret: "PHPSESSID=xyz", n: 1 });

  await assert.rejects(openJson(await deriveBoxKey("wrong", box.salt, box.iter), box));
  // 密文不含明文
  assert.ok(!JSON.stringify(box).includes("PHPSESSID"));
  // 两次 salt 不同 → 同口令不同密文
  const other = await sealJson(await deriveBoxKey("correct horse", randomSaltB64()), { secret: "PHPSESSID=xyz" }, randomSaltB64());
  assert.notEqual(other.ct, box.ct);
  assert.notEqual(randomSaltB64(), randomSaltB64());
});

test("crypto-box：畸形容器拒绝", async () => {
  const key = await deriveBoxKey("p", randomSaltB64());
  const bad = { v: 2, kdf: "PBKDF2-SHA256", iter: 1, salt: "", iv: "", ct: "" } as unknown as CipherBox;
  await assert.rejects(openJson(key, bad), /加密格式/);
});
