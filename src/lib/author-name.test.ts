import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAuthorAlias,
  authorKey,
  AUTHOR_ALIAS_ENTRY_LIMIT,
  AUTHOR_ALIAS_TEXT_LIMIT,
  clusterAuthorVariants,
  clusterNeedsAlias,
  normalizeAuthorName,
  parseAuthorAliases,
  type AuthorItem,
} from "./author-name.ts";

test("normalizeAuthorName：真实样本（@handle / 全角＠ / 装饰符 / ZWJ emoji）", () => {
  assert.equal(normalizeAuthorName("画師A@pixiv"), "画師A");
  assert.equal(normalizeAuthorName("name＠twitter"), "name");
  assert.equal(normalizeAuthorName("☆あいす★"), "あいす");
  assert.equal(normalizeAuthorName("some👨‍🎨one"), "someone"); // ZWJ 组合 emoji 在名字中间
  assert.equal(normalizeAuthorName("♪・古河渚・♪"), "古河渚");
  assert.equal(normalizeAuthorName("  miku  ✦"), "miku");
  assert.equal(normalizeAuthorName("ico  rina"), "ico rina"); // 折叠内部多余空白
});

test("normalizeAuthorName：保守边界（CJK / 括号 / 大小写 / 剥空回退）", () => {
  assert.equal(normalizeAuthorName("古河渚"), "古河渚"); // CJK 不动
  assert.equal(normalizeAuthorName("（社）古河渚"), "（社）古河渚"); // 括号内容不删
  assert.equal(normalizeAuthorName("Zero"), "Zero"); // 不大小写折叠
  assert.equal(normalizeAuthorName("★☆♪✦"), "★☆♪✦"); // 剥到空 → 回退原串
  assert.equal(normalizeAuthorName("♡♥♡"), "♡♥♡");
  assert.equal(normalizeAuthorName(""), "");
});

test("剥除顺序有锁：@handle → emoji → 空白折叠 → 首尾装饰", () => {
  // @ 在 emoji 前（单遍不回头）：@🎨user 的 @ 后面不是 ASCII，@ 步不吃；
  // emoji 步剥掉 🎨 后也不会回头再扫——防止把名字主体当 handle 误剥。
  // 若 emoji 先行，"@user" 会被整段剥掉只剩 ""，这就是顺序差。
  assert.equal(normalizeAuthorName("@🎨user"), "@user");
  // emoji 在空白折叠前：a 🎉 b 剥掉 emoji 留下双空格，靠后一步折叠成单空格。
  assert.equal(normalizeAuthorName("a 🎉 b"), "a b");
  // 首尾装饰最后：user-@pixiv 先剥 handle 再吃边缘 -；
  // 若装饰步先跑且不回头，会留下 "user-" 拖着尾巴。
  assert.equal(normalizeAuthorName("user-@pixiv"), "user");
  assert.equal(normalizeAuthorName("☆-user-☆@pixiv"), "user");
});

test("authorKey：id 与名字的分裂 / 归一语义", () => {
  // 两个不同画师规范化后同名，但有各自 authorId → 仍分拆（不误合）
  assert.notEqual(
    authorKey({ source: "pixiv", authorId: "1", author: "Zero" }),
    authorKey({ source: "pixiv", authorId: "2", author: "★Zero★" }),
  );
  // 同一 authorId 的两个名称变体 → 归一
  assert.equal(
    authorKey({ source: "pixiv", authorId: "11", author: "あいす" }),
    authorKey({ source: "pixiv", authorId: "11", author: "☆あいす★@pixiv" }),
  );
  // 无 authorId：装饰变体靠规范化归一；不同写法（平↔片假名）不合
  assert.equal(authorKey({ author: "☆あいす★" }), authorKey({ author: "あいす" }));
  assert.notEqual(authorKey({ author: "あいす" }), authorKey({ author: "アイス" }));
});

test("applyAuthorAlias：用户别名 > 规范化 > 原名", () => {
  const aliases = { あいす: "アイス", dead: "", same: "same" };
  assert.equal(applyAuthorAlias(normalizeAuthorName("☆あいす★"), aliases), "アイス");
  assert.equal(applyAuthorAlias(normalizeAuthorName("別人"), aliases), "別人");
  assert.equal(applyAuthorAlias("zero"), "zero"); // 无别名表原样返回
});

test("parseAuthorAliases：裁剪与坏项丢弃", () => {
  assert.deepEqual(parseAuthorAliases("nope"), {});
  assert.deepEqual(parseAuthorAliases(["a", "b"]), {});
  assert.deepEqual(parseAuthorAliases({ " a ": " b " }), { a: "b" }); // 键值都 trim
  assert.deepEqual(parseAuthorAliases({ a: "", b: null, "": "x" }), {}); // 空键值丢弃
  assert.deepEqual(parseAuthorAliases({ a: "a" }), {}); // 值 = 键丢弃
  const longKey = "k".repeat(200);
  const longVal = "v".repeat(200);
  const clamped = parseAuthorAliases({ [longKey]: longVal });
  assert.equal(Object.keys(clamped)[0]!.length, AUTHOR_ALIAS_TEXT_LIMIT);
  assert.equal(clamped[Object.keys(clamped)[0]!].length, AUTHOR_ALIAS_TEXT_LIMIT);
  const many: Record<string, string> = {};
  for (let i = 0; i < AUTHOR_ALIAS_ENTRY_LIMIT + 50; i += 1) many[`k${i}`] = `v${i}`;
  assert.equal(Object.keys(parseAuthorAliases(many)).length, AUTHOR_ALIAS_ENTRY_LIMIT); // 超限按序保留
});

function item(over: Partial<AuthorItem> & Pick<AuthorItem, "author">): AuthorItem {
  return { source: "pixiv", authorId: "", savedAt: 1, ...over };
}

test("clusterAuthorVariants：簇聚合与展示名取最新", () => {
  const rows = [
    item({ author: "あいす", authorId: "11", savedAt: 100 }),
    item({ author: "☆あいす★@pixiv", authorId: "11", savedAt: 300 }), // 簇内最新 → 展示名来源
    item({ author: "あいす", authorId: "11", savedAt: 200 }),
    item({ author: "☆古河渚★" }), // 无 id：规范化后与下面归一
    item({ author: "古河渚" }),
    item({ author: "別人" }),
  ];
  const clusters = clusterAuthorVariants(rows);
  const byKey = new Map(clusters.map((c) => [c.key, c]));
  const idCluster = byKey.get("pixiv:11");
  assert.ok(idCluster, "同 authorId 双名称应聚成一簇");
  assert.equal(idCluster.totalCount, 3);
  assert.equal(idCluster.displayName, "あいす"); // 最新 raw（☆あいす★@pixiv）经规范化
  assert.deepEqual(
    idCluster.variants.map((v) => v.name),
    ["あいす", "☆あいす★@pixiv"], // 计数降序：2 条的原名在前
  );
  const deco = byKey.get("n:古河渚");
  assert.ok(deco, "无 id 装饰变体经规范化归一");
  assert.equal(deco.totalCount, 2);
  assert.equal(deco.variants.length, 2); // raw 变体保留原样供挑选
  assert.equal(byKey.size, 3); // あいす簇 / 古河渚簇 / 別人簇
  assert.deepEqual(clusters.map((c) => c.totalCount), [3, 2, 1]); // 总数降序
  // 无名作者不参与
  assert.equal(clusterAuthorVariants([item({ author: "  " })]).length, 0);
});

test("clusterNeedsAlias：别名套上后簇从待整理列表消失", () => {
  const rows = [
    item({ author: "あいす", authorId: "11" }),
    item({ author: "アイス", authorId: "11" }),
  ];
  const [cluster] = clusterAuthorVariants(rows);
  assert.ok(clusterNeedsAlias(cluster)); // 两写法指向两个名字
  assert.equal(clusterNeedsAlias(cluster, { あいす: "アイス" }), false); // 归一后不再需要
  // 规范化就能兜住的装饰变体从来不需要整理
  const [deco] = clusterAuthorVariants([item({ author: "☆あいす★" }), item({ author: "あいす" })]);
  assert.equal(clusterNeedsAlias(deco), false);
});
