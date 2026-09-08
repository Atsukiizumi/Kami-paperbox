import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isDiskCacheableMedia,
  mediaCacheName,
  readCachedMedia,
  sniffMediaType,
  writeCachedMedia,
} from "./media-cache.server.ts";

test("sniffMediaType recognizes gif magic bytes", () => {
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
  assert.equal(sniffMediaType(gif, "application/octet-stream"), "image/gif");
  assert.equal(sniffMediaType(new Uint8Array([1, 2, 3]), "image/png"), "image/png");
});

test("mediaCacheName is stable hex for the same url", () => {
  const a = mediaCacheName("https://i.pximg.net/c/480x960/img-master/img/a.jpg");
  const b = mediaCacheName("https://i.pximg.net/c/480x960/img-master/img/a.jpg");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a.includes("127.0.0.1"), false);
});

test("isDiskCacheableMedia keeps pximg and booru, skips fanbox and search engines", () => {
  assert.equal(isDiskCacheableMedia(new URL("https://i.pximg.net/c/480x960/foo.jpg")), true);
  assert.equal(isDiskCacheableMedia(new URL("https://files.yande.re/sample/a.jpg")), true);
  assert.equal(isDiskCacheableMedia(new URL("https://cdn.donmai.us/sample/a.jpg")), true);
  assert.equal(isDiskCacheableMedia(new URL("https://downloads.fanbox.cc/images/a.jpg")), false);
  assert.equal(isDiskCacheableMedia(new URL("https://saucenao.com/img.jpg")), false);
});

test("writeCachedMedia round-trips bytes and type", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-media-"));
  try {
    const url = "https://i.pximg.net/c/480x960/img-master/img/demo.jpg";
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(readCachedMedia(url, root), null);
    writeCachedMedia(url, png, "image/jpeg", root);
    const hit = readCachedMedia(url, root);
    assert.ok(hit);
    assert.equal(hit.type, "image/jpeg");
    assert.deepEqual(Uint8Array.from(hit.bytes), png);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readCachedMedia misses after ttl", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-media-"));
  try {
    const url = "https://i.pximg.net/img-master/img/old.jpg";
    writeCachedMedia(url, new Uint8Array([1, 2, 3]), "image/jpeg", root, { now: 1_000 });
    assert.equal(readCachedMedia(url, root, { now: 1_000 + 8 * 24 * 60 * 60_000 }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
