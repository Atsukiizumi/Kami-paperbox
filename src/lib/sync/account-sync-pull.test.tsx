/**
 * serverSettingsEncrypted 跨用户绑定回归（CI 合集 e2e 间歇红第三根因）。
 *
 * 场景：用户 A（密文）拉取设 true → 换用户 B 的拉取 GET 失败（throw 路径
 * 不进循环，#176 的循环内刷新覆盖不到）→ B 无 KEK 时 settings 推送被守卫吞。
 * 修复：进拉取先按 userId 重置——新用户从 false 起步，GET 失败也干净。
 *
 * 放 tsx 段：pullAccountSync 动态 import backup-client 无后缀，strip-types
 * 段解析不了（vault-search-by-image.test.tsx 迁移同款原因）；内容无 JSX。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pullAccountSync,
  resetServerSettingsEncryptedFor,
  serverSettingsEncryptedState,
} from "./account-sync.ts";

test("encrypted 形态绑定 userId：换用户的拉取即使失败也不残留上账号的 true", async () => {
  resetServerSettingsEncryptedFor();
  const original = globalThis.fetch;
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    // 用户 A：拉到密文 settings 段 → 内部形态 true（无 KEK 会 skip，不影响形态记录）
    globalThis.fetch = (async () =>
      jsonResponse({
        segments: { settings: { payload: { kind: "cipher", box: { ct: "x" } }, exportedAt: 1 } },
        legacy: null,
        kdfSalt: null,
      })) as typeof fetch;
    await pullAccountSync("user-a");
    assert.equal(serverSettingsEncryptedState(), true, "A 的密文段被记录");

    // 用户 B：GET 500（throw，不进循环）——修复点：进函数已按新 userId 重置
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await assert.rejects(() => pullAccountSync("user-b"), /拉取账号数据失败/);
    assert.equal(serverSettingsEncryptedState(), false, "B 的失败拉取不残留 A 的 true（守卫不拦 B 的推送）");

    // B 成功空拉取（新账号无段）：仍 false
    globalThis.fetch = (async () => jsonResponse({ segments: {}, legacy: null, kdfSalt: null })) as typeof fetch;
    const rB = await pullAccountSync("user-b");
    assert.equal(Array.isArray(rB.applied), true);
    assert.equal(serverSettingsEncryptedState(), false);

    // A 回来（userId 切回）：进函数重置 false，空拉取循环内保持 false——
    // 真实 A 有密文段时循环会设回 true，这里验证切换本身不炸不残留
    const rA = await pullAccountSync("user-a");
    assert.equal(Array.isArray(rA.applied), true);
    assert.equal(serverSettingsEncryptedState(), false);
  } finally {
    globalThis.fetch = original;
    resetServerSettingsEncryptedFor();
  }
});
