import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountLabel,
  cookiesOf,
  createAccount,
  displayName,
  migrateLegacySettings,
} from "./accounts.ts";

describe("accounts", () => {
  it("migrates legacy cookies into one named account", () => {
    const next = migrateLegacySettings({
      pixivCookie: "PHPSESSID=abc",
      fanboxCookie: "  ",
    });
    assert.equal(next.accounts.length, 1);
    assert.equal(next.accounts[0].name, "账号 1");
    assert.equal(next.accounts[0].pixivCookie, "PHPSESSID=abc");
    assert.equal(next.activeAccountId, next.accounts[0].id);
  });

  it("keeps existing accounts and falls back if active is missing", () => {
    const a = createAccount("主号", "p1");
    const b = createAccount("小号", "", "f2");
    const next = migrateLegacySettings({
      accounts: [a, b],
      activeAccountId: "missing",
      pixivCookie: "old",
    });
    assert.equal(next.activeAccountId, a.id);
    assert.equal(cookiesOf(next.accounts, next.activeAccountId).pixivCookie, "p1");
    assert.equal(cookiesOf(next.accounts, b.id).fanboxCookie, "f2");
  });

  it("stays guest when nothing was saved", () => {
    const next = migrateLegacySettings({});
    assert.deepEqual(next, { accounts: [], activeAccountId: null });
    assert.equal(accountLabel(undefined), "未登录");
  });

  it("labels logged-in sources", () => {
    const acc = createAccount("主号", "pix", "fan");
    assert.equal(accountLabel(acc), "主号 · Pixiv/FANBOX");
  });

  it("marks guest pixiv cookies as invalid", () => {
    const guest = createAccount("主号", "abcdef0123456789deadbeef");
    assert.equal(displayName(guest, "pixiv"), "会话无效");
    const real = createAccount("主号", "12345678_abcdef0123456789deadbeef");
    assert.equal(displayName(real, "pixiv"), "已登录");
    real.pixivProfile = { id: "12345678", name: "紙匣" };
    assert.equal(displayName(real, "pixiv"), "紙匣");
  });
});
