import assert from "node:assert/strict";
import { test } from "node:test";
import { maskProxyUrl, parseProxyUrl } from "./proxy-url.ts";

test("empty is a cleared proxy", () => {
  assert.deepEqual(parseProxyUrl("  "), { ok: true, href: "" });
});

test("accepts host:port as http", () => {
  const parsed = parseProxyUrl("127.0.0.1:7890");
  assert.deepEqual(parsed, { ok: true, href: "http://127.0.0.1:7890" });
});

test("accepts http and socks5", () => {
  assert.deepEqual(parseProxyUrl("http://127.0.0.1:7890"), { ok: true, href: "http://127.0.0.1:7890" });
  assert.deepEqual(parseProxyUrl("socks5://127.0.0.1:1080"), { ok: true, href: "socks5://127.0.0.1:1080" });
  assert.deepEqual(parseProxyUrl("socks5h://192.168.1.2:1080"), {
    ok: true,
    href: "socks5h://192.168.1.2:1080",
  });
});

test("rejects junk schemes and hosts", () => {
  assert.equal(parseProxyUrl("file:///etc/passwd").ok, false);
  assert.equal(parseProxyUrl("http://0.0.0.0:8080").ok, false);
  assert.equal(parseProxyUrl("not a url").ok, false);
});

test("masks passwords", () => {
  assert.equal(maskProxyUrl("http://user:secret@127.0.0.1:7890"), "http://user:****@127.0.0.1:7890");
});
