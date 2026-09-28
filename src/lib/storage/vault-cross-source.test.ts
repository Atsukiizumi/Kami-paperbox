import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEARCH_BY_IMAGE_TOP_K,
  crossSourceClusters,
  nearestByDhash,
} from "./vault-cross-source.ts";
import { DUP_HASH_THRESHOLD, pairKeyOf } from "./vault-dedup.ts";

/** 翻转 hex 哈希的前 n 个 bit（二进制从最高位起）。抄 vault-dedup.test.ts 的桩。 */
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

const BASE = "f".repeat(16);

test("跨源过滤：不同 source 近邻成簇；纯同源同距离不成簇", () => {
  const cross = crossSourceClusters(
    [
      { key: "pixiv:1", source: "pixiv" },
      { key: "yande:1", source: "yande" },
    ],
    [
      { key: "pixiv:1", dhash: BASE },
      { key: "yande:1", dhash: flip(BASE, 8) },
    ],
  );
  assert.equal(cross.length, 1);
  assert.deepEqual(cross[0]!.keys, ["pixiv:1", "yande:1"]);
  assert.deepEqual(cross[0]!.sources, ["pixiv", "yande"]);

  const same = crossSourceClusters(
    [
      { key: "pixiv:1", source: "pixiv" },
      { key: "pixiv:2", source: "pixiv" },
    ],
    [
      { key: "pixiv:1", dhash: BASE },
      { key: "pixiv:2", dhash: flip(BASE, 8) },
    ],
  );
  assert.equal(same.length, 0);
});

test("混合簇：同源对不拆簇，簇整体跨源即保留", () => {
  const B = flip(BASE, 4);
  const C = flip(B, 4); // A~B 距 4、B~C 距 4、A~C 距 8，两两 ≤ 阈值
  const clusters = crossSourceClusters(
    [
      { key: "pixiv:1", source: "pixiv" },
      { key: "pixiv:2", source: "pixiv" },
      { key: "yande:1", source: "yande" },
    ],
    [
      { key: "pixiv:1", dhash: BASE },
      { key: "pixiv:2", dhash: B },
      { key: "yande:1", dhash: C },
    ],
  );
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.keys.length, 3);
  assert.deepEqual(clusters[0]!.sources, ["pixiv", "yande"]);
});

test("忽略对语义：全忽略簇消失；只忽略同源对或单条跨源对簇仍在", () => {
  const B = flip(BASE, 4);
  const C = flip(B, 4);
  const items = [
    { key: "pixiv:1", source: "pixiv" },
    { key: "pixiv:2", source: "pixiv" },
    { key: "yande:1", source: "yande" },
  ];
  const hashes = [
    { key: "pixiv:1", dhash: BASE },
    { key: "pixiv:2", dhash: B },
    { key: "yande:1", dhash: C },
  ];
  const samePair = pairKeyOf("pixiv:1", "pixiv:2");
  const crossPair1 = pairKeyOf("pixiv:2", "yande:1");
  const crossPair2 = pairKeyOf("pixiv:1", "yande:1");
  // 簇内全部两两 pair 都忽略 → 无边可连 → 簇消失
  assert.equal(
    crossSourceClusters(items, hashes, DUP_HASH_THRESHOLD, [samePair, crossPair1, crossPair2])
      .length,
    0,
  );
  // 只忽略同源对：跨源边仍在 → 簇仍在
  assert.equal(crossSourceClusters(items, hashes, DUP_HASH_THRESHOLD, [samePair]).length, 1);
  // 只忽略一条跨源对：另一条跨源边仍在 → 簇仍在
  assert.equal(crossSourceClusters(items, hashes, DUP_HASH_THRESHOLD, [crossPair1]).length, 1);
});

test("阈值边界：距离等于 DUP_HASH_THRESHOLD 入簇，+1 不入", () => {
  const items = [
    { key: "pixiv:1", source: "pixiv" },
    { key: "yande:1", source: "yande" },
  ];
  const at = crossSourceClusters(items, [
    { key: "pixiv:1", dhash: BASE },
    { key: "yande:1", dhash: flip(BASE, DUP_HASH_THRESHOLD) },
  ]);
  assert.equal(at.length, 1);
  assert.equal(at[0]!.maxDistance, DUP_HASH_THRESHOLD);
  assert.equal(
    crossSourceClusters(items, [
      { key: "pixiv:1", dhash: BASE },
      { key: "yande:1", dhash: flip(BASE, DUP_HASH_THRESHOLD + 1) },
    ]).length,
    0,
  );
});

test("脏行：items 外的哈希行静默忽略；items 空 → 空结果", () => {
  // ghost:9 不在 items（软删残留）——不丢弃的话会与 pixiv:1 连边
  const clusters = crossSourceClusters(
    [{ key: "pixiv:1", source: "pixiv" }],
    [
      { key: "pixiv:1", dhash: BASE },
      { key: "ghost:9", dhash: flip(BASE, 2) },
    ],
  );
  assert.equal(clusters.length, 0);
  assert.equal(crossSourceClusters([], [{ key: "pixiv:1", dhash: BASE }]).length, 0);
});

test("nearestByDhash：距离升序、同距离按 key 稳定排序、limit 截断", () => {
  const hashes = [
    { key: "yande:9", dhash: flip(BASE, 6) },
    { key: "pixiv:3", dhash: flip(BASE, 2) },
    { key: "danbooru:2", dhash: flip(BASE, 2) },
    { key: "konachan:1", dhash: "0".repeat(16) }, // 远邻不入
  ];
  const out = nearestByDhash(hashes, BASE);
  assert.deepEqual(out.map((m) => m.key), ["danbooru:2", "pixiv:3", "yande:9"]);
  assert.deepEqual(out.map((m) => m.distance), [2, 2, 6]);
  assert.deepEqual(
    nearestByDhash(hashes, BASE, { limit: 2 }).map((m) => m.key),
    ["danbooru:2", "pixiv:3"],
  );
});

test("nearestByDhash：默认 limit = SEARCH_BY_IMAGE_TOP_K（8）", () => {
  assert.equal(SEARCH_BY_IMAGE_TOP_K, 8);
  const hashes = Array.from({ length: 12 }, (_, i) => ({
    key: `yande:${i}`,
    dhash: flip(BASE, (i % 8) + 1), // 距离 1..8，全部 ≤ 阈值 → 12 条命中
  }));
  assert.equal(nearestByDhash(hashes, BASE).length, SEARCH_BY_IMAGE_TOP_K);
  assert.equal(nearestByDhash(hashes, BASE, { limit: 3 }).length, 3);
});

test("nearestByDhash：excludeKeys 排除条目（M3 排除自己的用法）", () => {
  const hashes = [
    { key: "pixiv:1", dhash: BASE },
    { key: "yande:1", dhash: flip(BASE, 2) },
  ];
  assert.deepEqual(
    nearestByDhash(hashes, BASE, { excludeKeys: new Set(["pixiv:1"]) }).map((m) => m.key),
    ["yande:1"],
  );
});

test("nearestByDhash：skipSameSourceAs 只留跨源（缺省按 key 前缀解析 source）", () => {
  const hashes = [
    { key: "pixiv:1", dhash: BASE },
    { key: "pixiv:2", dhash: flip(BASE, 2) },
    { key: "yande:1", dhash: flip(BASE, 4) },
  ];
  assert.deepEqual(
    nearestByDhash(hashes, BASE, { skipSameSourceAs: "pixiv" }).map((m) => m.key),
    ["yande:1"],
  );
  // 显式 sourceOf 覆盖缺省的前缀口径
  assert.deepEqual(
    nearestByDhash(hashes, BASE, {
      sourceOf: (key) => (key.startsWith("pixiv") ? "a" : "b"),
      skipSameSourceAs: "a",
    }).map((m) => m.key),
    ["yande:1"],
  );
});

test("nearestByDhash：忽略对跳过（查询方无 key，按端点近似）", () => {
  const hashes = [
    { key: "pixiv:1", dhash: BASE },
    { key: "yande:1", dhash: flip(BASE, 2) },
    { key: "yande:2", dhash: flip(BASE, 4) },
  ];
  // M3 实际调用形态：excludeKeys 排除自己 + dismissed 跳过被忽略对的另一端
  assert.deepEqual(
    nearestByDhash(hashes, BASE, {
      excludeKeys: new Set(["pixiv:1"]),
      dismissed: [pairKeyOf("yande:1", "pixiv:1")],
    }).map((m) => m.key),
    ["yande:2"],
  );
  // 端点近似的边界：被忽略对涉及「查询本尊」时该条目同样被跳过（提示面宁缺勿滥）
  assert.deepEqual(
    nearestByDhash(hashes, BASE, { dismissed: [pairKeyOf("yande:1", "pixiv:1")] }).map(
      (m) => m.key,
    ),
    ["yande:2"],
  );
});

test("nearestByDhash：全表无近邻 / 空表返回空", () => {
  assert.deepEqual(nearestByDhash([{ key: "yande:1", dhash: "0".repeat(16) }], BASE), []);
  assert.deepEqual(nearestByDhash([], BASE), []);
});
