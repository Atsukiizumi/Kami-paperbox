import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterDupes, pairKeyOf } from "./vault-dedup.ts";
import { dhashFromRgba } from "./dhash.ts";

/** 翻转 hex 哈希的前 n 个 bit（二进制从最高位起）。 */
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

test("pairKeyOf 排序保证 a|b 与 b|a 相同", () => {
  assert.equal(pairKeyOf("pixiv:1", "danbooru:2"), pairKeyOf("danbooru:2", "pixiv:1"));
});

test("A~B、B~C、A⋠C：并查集聚成一组", () => {
  const A = "f".repeat(16);
  const B = flip(A, 8);
  const C = flip(B, 8);
  const groups = clusterDupes(
    [
      { key: "a", dhash: A },
      { key: "b", dhash: B },
      { key: "c", dhash: C },
      { key: "d", dhash: "0".repeat(16) },
    ],
    10,
  );
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0]!.keys].sort(), ["a", "b", "c"]);
  assert.ok(groups[0]!.maxDistance <= 10);
});

test("dismissed 对不连边；孤立成员不成组", () => {
  const A = "f".repeat(16);
  const B = flip(A, 8);
  const groups = clusterDupes(
    [
      { key: "a", dhash: A },
      { key: "b", dhash: B },
      { key: "c", dhash: "0".repeat(16) },
    ],
    10,
    [pairKeyOf("a", "b")],
  );
  assert.equal(groups.length, 0);
});

test("阈值边界：距离等于阈值成组，大于不成", () => {
  const A = "f".repeat(16);
  const B = flip(A, 10);
  assert.equal(clusterDupes([{ key: "a", dhash: A }, { key: "b", dhash: B }], 10).length, 1);
  assert.equal(clusterDupes([{ key: "a", dhash: A }, { key: "b", dhash: B }], 9).length, 0);
});

test("真实 dHash 输出可聚类（同图不同尺寸）", () => {
  const gray = (w: number, h: number) => {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round((x / w) * 200 + (y / h) * 55);
        out.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    return out;
  };
  const big = dhashFromRgba(400, 400, gray(400, 400));
  const small = dhashFromRgba(120, 90, gray(120, 90));
  const groups = clusterDupes(
    [
      { key: "pixiv:1", dhash: big },
      { key: "danbooru:2", dhash: small },
    ],
    10,
  );
  assert.equal(groups.length, 1);
});
