import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeCandidates, loginJobBusy, pickSession } from "./browser-login.ts";

test("picks pixiv and fanbox session cookies", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "abcdef0123456789deadbeef", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "fanbox-token-1", domain: ".fanbox.cc" },
    { name: "other", value: "nope", domain: ".pixiv.net" },
  ]);
  assert.equal(got.pixiv, "abcdef0123456789deadbeef");
  assert.equal(got.fanbox, "fanbox-token-1");
});

test("ignores short or empty values", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "short", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.pixiv, "");
  assert.equal(got.fanbox, "");
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

test("login job busy flags", () => {
  assert.equal(loginJobBusy("idle"), false);
  assert.equal(loginJobBusy("done"), false);
  assert.equal(loginJobBusy("error"), false);
  assert.equal(loginJobBusy("launching"), true);
  assert.equal(loginJobBusy("waiting"), true);
});
