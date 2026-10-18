import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FANBOX_LOGIN_URL,
  X_LOGIN_URL,
  canShowLoginWindow,
  chromeCandidates,
  fanboxCookieHeader,
  fanboxSessionFrom,
  isPixivLoggedInSession,
  loginJobBusy,
  parseCookieDump,
  parseLoginSite,
  pickSession,
  pickXSession,
  pixivCookieHeader,
  pixivUserIdFromCookie,
  sanitizePixivCookie,
} from "./browser-login.ts";

test("picks logged-in pixiv and fanbox session cookies", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "12345678_abcdef0123456789deadbeef", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "12345678_abcdef0123456789deadbeef", domain: ".fanbox.cc" },
    { name: "other", value: "nope", domain: ".pixiv.net" },
  ]);
  assert.equal(got.pixiv, "12345678_abcdef0123456789deadbeef");
  assert.equal(got.fanbox, "12345678_abcdef0123456789deadbeef");
});

test("ignores guest PHPSESSID and guest FANBOXSESSID", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "abcdef0123456789deadbeef", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "fanbox-guest-token-16ok", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.pixiv, "");
  assert.equal(got.fanbox, "");
});

test("reads PHPSESSID on fanbox domain as fanbox session", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "42_abcdef0123456789deadbeef", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.fanbox, "42_abcdef0123456789deadbeef");
});

test("ignores short or empty values", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "short", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.pixiv, "");
  assert.equal(got.fanbox, "");
});

test("logged-in session helper and header", () => {
  assert.equal(isPixivLoggedInSession("12345678_abcdef0123456789deadbeef"), true);
  assert.equal(isPixivLoggedInSession("PHPSESSID=42_abcdef0123456789deadbeef"), true);
  assert.equal(isPixivLoggedInSession("PHPSESSID=42_abcdef0123456789deadbeef; p_ab_id=2"), true);
  assert.equal(isPixivLoggedInSession("1_abcdefghijklmnop"), true);
  assert.equal(isPixivLoggedInSession("abcdef0123456789deadbeef"), false);
  assert.equal(pixivUserIdFromCookie("PHPSESSID=42_abcdef0123456789deadbeef"), "42");
  assert.equal(sanitizePixivCookie("abcdef0123456789deadbeef"), "");
  assert.equal(pixivCookieHeader("abcdef0123456789deadbeef"), undefined);
  assert.equal(
    pixivCookieHeader("PHPSESSID=42_abcdef0123456789deadbeef"),
    "PHPSESSID=42_abcdef0123456789deadbeef",
  );
});

test("fanbox header uses logged-in token and can fall back to pixiv", () => {
  assert.equal(fanboxCookieHeader("fanbox-guest-token-16ok"), undefined);
  assert.equal(
    fanboxCookieHeader("42_abcdef0123456789deadbeef"),
    "FANBOXSESSID=42_abcdef0123456789deadbeef; PHPSESSID=42_abcdef0123456789deadbeef",
  );
  assert.equal(
    fanboxCookieHeader("", "99_abcdef0123456789deadbeef"),
    "FANBOXSESSID=99_abcdef0123456789deadbeef; PHPSESSID=99_abcdef0123456789deadbeef",
  );
  assert.equal(fanboxSessionFrom("", "99_abcdef0123456789deadbeef"), "99_abcdef0123456789deadbeef");
  assert.equal(
    fanboxCookieHeader("42_fanboxsessionvaluexx", "99_pixivsessionvaluexxx"),
    "FANBOXSESSID=42_fanboxsessionvaluexx; PHPSESSID=99_pixivsessionvaluexxx",
  );
});

test("fanbox login goes through pixiv account picker and auth/start", () => {
  assert.equal(
    FANBOX_LOGIN_URL,
    "https://accounts.pixiv.net/login?prompt=select_account&return_to=https%3A%2F%2Fwww.fanbox.cc%2Fauth%2Fstart&source=fanbox",
  );
});

test("x login url is the official flow entry", () => {
  assert.equal(X_LOGIN_URL, "https://x.com/i/flow/login");
});

test("login site whitelist lets pixiv/fanbox/x through and rejects the rest", () => {
  assert.equal(parseLoginSite("pixiv"), "pixiv");
  assert.equal(parseLoginSite("fanbox"), "fanbox");
  assert.equal(parseLoginSite("x"), "x");
  assert.equal(parseLoginSite("twitter"), null);
  assert.equal(parseLoginSite(""), null);
  assert.equal(parseLoginSite(undefined), null);
  assert.equal(parseLoginSite(1), null);
  assert.equal(parseLoginSite({ site: "x" }), null);
});

test("pickXSession：已登录（.x.com 成对）返回规范串", () => {
  const token = "a1b2c3d4e5f6a7b8c9d0";
  const ct0 = "cT0vAlUe-4Me_xYz9";
  assert.equal(
    pickXSession([
      { name: "auth_token", value: token, domain: ".x.com" },
      { name: "ct0", value: ct0, domain: ".x.com" },
      { name: "guest_id", value: "guest-noise", domain: ".x.com" },
    ]),
    `auth_token=${token}; ct0=${ct0}`,
  );
});

test("pickXSession：未登录（无 auth_token）返回 null", () => {
  assert.equal(
    pickXSession([
      { name: "guest_id", value: "guest-noise", domain: ".x.com" },
      { name: "ct0", value: "cT0vAlUe-4Me_xYz9", domain: ".x.com" },
    ]),
    null,
  );
  assert.equal(pickXSession([]), null);
});

test("pickXSession：只有 auth_token 没有 ct0 返回 null（sanitize 双值门槛）", () => {
  assert.equal(
    pickXSession([{ name: "auth_token", value: "a1b2c3d4e5f6a7b8c9d0", domain: ".x.com" }]),
    null,
  );
});

test("pickXSession：多域同名取 .x.com 域优先；空值不算数", () => {
  assert.equal(
    pickXSession([
      { name: "auth_token", value: "FROM-TWITTER-DOMAIN", domain: ".twitter.com" },
      { name: "auth_token", value: "FROM-X-DOMAIN", domain: ".x.com" },
      { name: "ct0", value: "CT0-ON-X", domain: "x.com" },
      { name: "ct0", value: "", domain: ".x.com" },
    ]),
    "auth_token=FROM-X-DOMAIN; ct0=CT0-ON-X",
  );
  // auth_token 只在非 x 域、ct0 在 .x.com：仍成对可用（fallback 取 twitter 域值）
  assert.equal(
    pickXSession([
      { name: "auth_token", value: "TW-ONLY", domain: ".twitter.com" },
      { name: "ct0", value: "CT0-ON-X", domain: ".x.com" },
    ]),
    "auth_token=TW-ONLY; ct0=CT0-ON-X",
  );
});

test("parses cookie dumps from headers, json, and netscape files", () => {
  const header = parseCookieDump("PHPSESSID=12345678_abcdef0123456789deadbeef; path=/");
  assert.equal(header.pixiv, "12345678_abcdef0123456789deadbeef");

  const json = parseCookieDump(
    JSON.stringify([
      { name: "PHPSESSID", value: "42_abcdef0123456789deadbeef", domain: ".pixiv.net" },
      { name: "FANBOXSESSID", value: "42_abcdef0123456789deadbeef", domain: ".fanbox.cc" },
    ]),
  );
  assert.equal(json.pixiv, "42_abcdef0123456789deadbeef");
  assert.equal(json.fanbox, "42_abcdef0123456789deadbeef");

  const netscape = parseCookieDump(
    [
      "# Netscape HTTP Cookie File",
      ".pixiv.net\tTRUE\t/\tTRUE\t0\tPHPSESSID\t99_abcdef0123456789deadbeef",
    ].join("\n"),
  );
  assert.equal(netscape.pixiv, "99_abcdef0123456789deadbeef");

  const guest = parseCookieDump("PHPSESSID=abcdef0123456789deadbeef");
  assert.equal(guest.pixiv, "");
  assert.equal(parseCookieDump("FANBOXSESSID=fanbox-guest-token-16ok").fanbox, "");

  // 拆框（2026-09-14）：裸会话值只认 Pixiv，不再同时填 fanbox——两站格式同形，
  // 双填会让「粘一个框、另一个框跟着变」。FANBOX 裸值走定向粘贴按站点解释。
  const bare = parseCookieDump("77_abcdef0123456789deadbeef");
  assert.equal(bare.pixiv, "77_abcdef0123456789deadbeef");
  assert.equal(bare.fanbox, "");
});

test("windows chrome candidates include edge", () => {
  const list = chromeCandidates("win32", {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
    KAMI_CHROME: "D:\\Chrome\\chrome.exe",
  });
  assert.equal(list[0], "D:\\Chrome\\chrome.exe");
  assert.ok(list.some((p) => p.endsWith("msedge.exe")));
  assert.ok(list.some((p) => p.includes("Chrome SxS")));
});

test("login window needs a real desktop, not a grok/server display", () => {
  assert.equal(canShowLoginWindow("linux", {}), false);
  assert.equal(canShowLoginWindow("linux", { DISPLAY: ":0" }), false);
  assert.equal(canShowLoginWindow("linux", { DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" }), true);
  assert.equal(canShowLoginWindow("linux", { GROK_AGENT: "1", DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" }), false);
  assert.equal(canShowLoginWindow("win32", {}), true);
  assert.equal(canShowLoginWindow("win32", { GROK_AGENT: "1" }), false);
});

test("login job busy flags", () => {
  assert.equal(loginJobBusy("idle"), false);
  assert.equal(loginJobBusy("done"), false);
  assert.equal(loginJobBusy("error"), false);
  assert.equal(loginJobBusy("launching"), true);
  assert.equal(loginJobBusy("waiting"), true);
});
