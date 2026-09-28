/**
 * 以图搜匣判定核心的组合单测（路由壳薄，核心 = dhashInfoFromBytesSync +
 * nearestByDhash 的序列，路由按同序调用）。
 * 命中带距离 / 异图空 / 阈值边界（dhash 桩）/ webp 坏字节不落哈希行。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import type { Source } from "../types.ts";
import { dhashInfoFromBytesSync } from "./dhash.ts";
import { DUP_HASH_THRESHOLD } from "./vault-dedup.ts";
import { SEARCH_BY_IMAGE_TOP_K, nearestByDhash } from "./vault-cross-source.ts";
import { openVaultStore } from "./vault-store.server.ts";

/** 翻转 hex 哈希的前 n 个 bit。抄 vault-dedup.test.ts 的桩。 */
function flip(hex: string, n: number): string {
  let bits = "";
  for (const ch of hex) bits += parseInt(ch, 16).toString(2).padStart(4, "0");
  bits = bits
    .split("")
    .map((b, i) => (i < n ? (b === "1" ? "0" : "1") : b))
    .join("");
  let out = "";
  for (let i = 0; i < bits.length; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return out;
}

/** 灰度 PNG 生成器：fill 给出 (x,y) 的亮度。 */
function pngBytes(fill: (x: number) => number, w = 64, h = 64): Uint8Array {
  const img = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      const v = fill(x);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return new Uint8Array(PNG.sync.write(img));
}

// 左暗右亮渐变（dhash 全 1）与纯色（dhash 全 0）：互为最远图，距离 64
const gradient = pngBytes((x) => Math.round((x / 63) * 255));
const solid = pngBytes(() => 128);

function metaOf(key: string) {
  const cut = key.indexOf(":");
  return {
    key,
    source: key.slice(0, cut) as Source, // 造数自合法 vault key；运行时 put 还会过 parseVaultKey
    id: key.slice(cut + 1),
    title: "t",
    author: "a",
    authorId: "a1",
    tags: [],
    pageCount: 1,
    savedAt: 1_700_000_000_000,
    bytes: 0,
  };
}

test("同 bytes 不同 source 两条：入库即算哈希，搜匣命中带距离 0", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-sbi-"));
  const store = openVaultStore(root);
  try {
    store.put(metaOf("pixiv:9101"), [{ bytes: gradient, ext: "png", mime: "image/png" }]);
    store.put(metaOf("yande:9102"), [{ bytes: gradient, ext: "png", mime: "image/png" }]);
    const hashes = store.hashes();
    assert.equal(hashes.length, 2);
    // 路由同款调用：全表 + topK 常量，不排除（上传图不在匣内）
    const out = nearestByDhash(hashes, hashes[0]!.dhash, { limit: SEARCH_BY_IMAGE_TOP_K });
    assert.deepEqual(
      out.map((m) => m.key).sort(),
      ["pixiv:9101", "yande:9102"],
    );
    assert.equal(out.find((m) => m.key === "yande:9102")!.distance, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("异图（渐变 vs 纯色）：距离超阈值 → 空返回", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-sbi-"));
  const store = openVaultStore(root);
  try {
    store.put(metaOf("pixiv:9103"), [{ bytes: solid, ext: "png", mime: "image/png" }]);
    const info = dhashInfoFromBytesSync(gradient, "image/png");
    assert.ok(info);
    assert.equal(
      nearestByDhash(store.hashes(), info.dhash, { limit: SEARCH_BY_IMAGE_TOP_K }).length,
      0,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("阈值边界（dhash 桩经 putHash 覆盖）：距离 10 命中、11 不命中", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-sbi-"));
  const store = openVaultStore(root);
  try {
    // 哈希读口径 JOIN works 表，先用真 PNG 开行再覆盖成桩值
    store.put(metaOf("pixiv:9104"), [{ bytes: gradient, ext: "png", mime: "image/png" }]);
    store.put(metaOf("yande:9105"), [{ bytes: gradient, ext: "png", mime: "image/png" }]);
    const base = "f".repeat(16);
    store.putHash("pixiv:9104", base, 64, 64);
    const hit = () =>
      nearestByDhash(store.hashes(), base).find((m) => m.key === "yande:9105");
    store.putHash("yande:9105", flip(base, DUP_HASH_THRESHOLD), 64, 64);
    assert.equal(hit()?.distance, DUP_HASH_THRESHOLD);
    store.putHash("yande:9105", flip(base, DUP_HASH_THRESHOLD + 1), 64, 64);
    assert.equal(hit(), undefined);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("webp / 坏字节：读不出哈希（路由 400 半边），put 后 hashes() 不含该 key", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-sbi-"));
  const store = openVaultStore(root);
  try {
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    assert.equal(dhashInfoFromBytesSync(fakeWebp, "image/webp"), null);
    assert.equal(dhashInfoFromBytesSync(new Uint8Array([1, 2, 3]), "image/png"), null);
    store.put(metaOf("pixiv:9106"), [{ bytes: fakeWebp, ext: "webp", mime: "image/webp" }]);
    assert.equal(store.hashes().some((h) => h.key === "pixiv:9106"), false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
