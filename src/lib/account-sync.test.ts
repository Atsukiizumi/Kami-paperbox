import assert from "node:assert/strict";
import { test } from "node:test";
import { omitSettingsCredentials, shouldApplySegment } from "./account-sync.ts";

test("shouldApplySegment 只在服务端更新时覆盖（分段版）", () => {
  const markers = { userId: "u1", marks: { settings: 1000, vault: 500 } };
  // 同段：旧 / 相同不覆盖，新覆盖
  assert.equal(shouldApplySegment("settings", 999, markers, "u1"), false);
  assert.equal(shouldApplySegment("settings", 1000, markers, "u1"), false);
  assert.equal(shouldApplySegment("settings", 1001, markers, "u1"), true);
  // 不同段互不干扰：settings 的新 marker 不影响 vault 的旧判断
  assert.equal(shouldApplySegment("vault", 600, markers, "u1"), true);
  // 换账号 / 无 marker / force
  assert.equal(shouldApplySegment("settings", 1, markers, "u2"), true);
  assert.equal(shouldApplySegment("settings", 1, null, "u1"), true);
  assert.equal(shouldApplySegment("settings", 1, markers, "u1", true), true);
});

test("omitSettingsCredentials 把凭据字段真的拿掉", () => {
  const out = omitSettingsCredentials({
    settings: {
      pixivCookie: "PHPSESSID=x",
      fanboxCookie: "FANBOXSESSID=y",
      danbooruLogin: "u",
      danbooruApiKey: "k",
      saucenaoApiKey: "s",
      accounts: [{ id: "a", pixivCookie: "z" }],
      activeAccountId: "a",
      safeMode: true,
      folderLabel: "Kami",
    },
    proxyUrl: "http://127.0.0.1:7890",
  });
  const settings = out.settings as Record<string, unknown>;
  assert.equal(settings.pixivCookie, "");
  assert.equal(settings.fanboxCookie, "");
  assert.equal(settings.danbooruLogin, "");
  assert.equal(settings.danbooruApiKey, "");
  assert.equal(settings.saucenaoApiKey, "");
  assert.deepEqual(settings.accounts, []);
  assert.equal(settings.activeAccountId, "");
  // 非凭据字段保留
  assert.equal(settings.safeMode, true);
  assert.equal(settings.folderLabel, "Kami");
  assert.equal(out.proxyUrl, "http://127.0.0.1:7890", "代理地址含密码，留在加密面");
});