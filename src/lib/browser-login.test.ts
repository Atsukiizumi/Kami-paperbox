import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FANBOX_LOGIN_URL,
  canShowLoginWindow,
  chromeCandidates,
  fanboxCookieHeader,
  fanboxSessionFrom,
  isPixivLoggedInSession,
  loginJobBusy,
  parseCookieDump,
  pickSession,
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
});

test("fanbox login goes through pixiv account picker and auth/start", () => {
  assert.equal(
    FANBOX_LOGIN_URL,
    "https://accounts.pixiv.net/login?prompt=select_account&return_to=https%3A%2F%2Fwww.fanbox.cc%2Fauth%2Fstart&source=fanbox",
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
