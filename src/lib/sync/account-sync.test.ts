import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeCredentialsOnPull,
  omitSettingsCredentials,
  readCredsDirty,
  shouldApplySegment,
  SENSITIVE_SETTINGS_FIELDS,
} from "./account-sync.ts";

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
test("mergeCredentialsOnPull：访客期新录凭据（本地非空）压过远端旧档", () => {
  const remote = {
    settings: {
      pixivCookie: "12345678_oldToken",
      danbooruLogin: "",
      accounts: [{ id: "a", pixivCookie: "12345678_oldToken" }],
      safeMode: true,
    },
    proxyUrl: "",
  } as unknown as Parameters<typeof mergeCredentialsOnPull>[0];
  const local = {
    pixivCookie: "12345678_newToken",
    danbooruLogin: "",
    accounts: [{ id: "a", pixivCookie: "12345678_newToken" }],
  };
  const { settings, merged } = mergeCredentialsOnPull(remote, local);
  const rec = settings.settings as Record<string, unknown>;
  assert.equal(rec.pixivCookie, "12345678_newToken", "本地新 cookie 保留");
  assert.deepEqual(rec.accounts, [{ id: "a", pixivCookie: "12345678_newToken" }]);
  assert.equal(merged, true);
  // 非凭据字段仍取远端
  assert.equal(rec.safeMode, true);
});

test("mergeCredentialsOnPull：本地为空取远端（新设备恢复流不回归）", () => {
  const remote = {
    settings: { pixivCookie: "12345678_cloudToken", accounts: [{ id: "a" }], hideAi: true },
    proxyUrl: "",
  } as unknown as Parameters<typeof mergeCredentialsOnPull>[0];
  const { settings, merged } = mergeCredentialsOnPull(remote, { pixivCookie: "", accounts: [] });
  const rec = settings.settings as Record<string, unknown>;
  assert.equal(rec.pixivCookie, "12345678_cloudToken", "本地空 → 远端凭据完整恢复");
  assert.equal(merged, false);
});

test("mergeCredentialsOnPull：字段相同不算合并", () => {
  const remote = {
    settings: { pixivCookie: "same", danbooruApiKey: "k" },
    proxyUrl: "",
  } as unknown as Parameters<typeof mergeCredentialsOnPull>[0];
  const { merged } = mergeCredentialsOnPull(remote, { pixivCookie: "same", danbooruApiKey: "k" });
  assert.equal(merged, false);
});

test("脏标记读取在无 localStorage 环境（node 测试）下安全退化为 false", () => {
  assert.equal(readCredsDirty(), false);
});

test("omitSettingsCredentials 的清单与 SENSITIVE_SETTINGS_FIELDS 同源", () => {
  // TD-21：两处清单必须同步演进——这里锁字段集
  assert.deepEqual(
    [...SENSITIVE_SETTINGS_FIELDS],
    ["pixivCookie", "fanboxCookie", "danbooruLogin", "danbooruApiKey", "saucenaoApiKey", "accounts", "activeAccountId"],
  );
});
