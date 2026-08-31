import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canShowLoginWindow,
  chromeCandidates,
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
    { name: "FANBOXSESSID", value: "fanbox-token-16ok", domain: ".fanbox.cc" },
    { name: "other", value: "nope", domain: ".pixiv.net" },
  ]);
  assert.equal(got.pixiv, "12345678_abcdef0123456789deadbeef");
  assert.equal(got.fanbox, "fanbox-token-16ok");
});

test("ignores guest PHPSESSID that pixiv sets before login", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "abcdef0123456789deadbeef", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "short", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.pixiv, "");
  assert.equal(got.fanbox, "");
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

test("parses cookie dumps from headers, json, and netscape files", () => {
  const header = parseCookieDump("PHPSESSID=12345678_abcdef0123456789deadbeef; path=/");
  assert.equal(header.pixiv, "12345678_abcdef0123456789deadbeef");

  const json = parseCookieDump(
    JSON.stringify([
      { name: "PHPSESSID", value: "42_abcdef0123456789deadbeef", domain: ".pixiv.net" },
      { name: "FANBOXSESSID", value: "fanbox-token-16ok", domain: ".fanbox.cc" },
    ]),
  );
  assert.equal(json.pixiv, "42_abcdef0123456789deadbeef");
  assert.equal(json.fanbox, "fanbox-token-16ok");

  const netscape = parseCookieDump(
    [
      "# Netscape HTTP Cookie File",
      ".pixiv.net\tTRUE\t/\tTRUE\t0\tPHPSESSID\t99_abcdef0123456789deadbeef",
    ].join("\n"),
  );
  assert.equal(netscape.pixiv, "99_abcdef0123456789deadbeef");

  const guest = parseCookieDump("PHPSESSID=abcdef0123456789deadbeef");
  assert.equal(guest.pixiv, "");
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
