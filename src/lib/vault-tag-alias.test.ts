import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTagAlias,
  applyTagAliases,
  clusterNeedsAlias,
  clusterTagVariants,
  normalizeTagKey,
  parseTagAliases,
  tagsAfterAdd,
  tagsAfterRemove,
  TAG_ALIAS_ENTRY_LIMIT,
  TAG_ALIAS_TEXT_LIMIT,
  type TagItemLike,
} from "./vault-tag-alias.ts";

test("normalizeTagKey：大小写 / 全半角 / 空白 / NFKC 机械变体归一", () => {
  assert.equal(normalizeTagKey("WutheringWaves"), "wutheringwaves");
  assert.equal(normalizeTagKey("wutheringwaves"), "wutheringwaves"); // 大小写归一
  assert.equal(normalizeTagKey("ＷｕｔｈｅｒｉｎｇＷａｖｅｓ"), "wutheringwaves"); // 全角 NFKC 折半角
  assert.equal(normalizeTagKey("　鸣潮　"), "鸣潮"); // 全角空格 NFKC 折空格再 trim
  assert.equal(normalizeTagKey("Wa　ves"), "wa ves"); // 全角空格 → 单空格
  assert.equal(normalizeTagKey("  a　 b  "), "a b"); // 折叠内部空白
  assert.equal(normalizeTagKey("ﬁne"), "fine"); // NFKC 连字拆解
  assert.equal(normalizeTagKey("ｗaves"), "waves"); // 半个全角混排也收
});

test("normalizeTagKey：非目标边界（繁简 / 跨语言不合、空与非字符串）", () => {
  // 繁简是不同字符，NFKC 不动——跨语言 / 繁简归并靠用户拍板，不自动合
  assert.notEqual(normalizeTagKey("鳴潮"), normalizeTagKey("鸣潮"));
  assert.notEqual(normalizeTagKey("鳴潮"), normalizeTagKey("WutheringWaves"));
  assert.equal(normalizeTagKey("鳴潮"), "鳴潮");
  assert.equal(normalizeTagKey(""), "");
  assert.equal(normalizeTagKey("   "), "");
});

test("applyTagAlias：单跳映射，绝不链式二跳", () => {
  const aliases = { 鳴潮: "鸣潮", 鸣潮: "WutheringWaves" }; // 故意成链的脏表
  assert.equal(applyTagAlias("鳴潮", aliases), "鸣潮"); // A→B 落到 B，不再追 B→C
  assert.equal(applyTagAlias("Waves", aliases), "Waves"); // 未命中原样返回
  assert.equal(applyTagAlias("鳴潮"), "鳴潮"); // 无表原样返回
  assert.equal(applyTagAlias("鳴潮", { 鳴潮: "  " }), "鳴潮"); // 空值视作未命中
  assert.equal(applyTagAlias("鳴潮", { 鳴潮: "鳴潮" }), "鳴潮"); // 自指视作未命中
});

test("applyTagAliases：trim、去空、去重保首次出现序", () => {
  const aliases = { 鳴潮: "鸣潮" };
  assert.deepEqual(applyTagAliases(["鳴潮", "鸣潮"], aliases), ["鸣潮"]); // 双变体同图只剩规范名
  assert.deepEqual(applyTagAliases([" b ", "", "a", "b", undefined as unknown as string], undefined), ["b", "a"]);
  assert.deepEqual(applyTagAliases(["x", "x", "y"], undefined), ["x", "y"]); // 无表也去重
  assert.deepEqual(applyTagAliases([], aliases), []);
});

test("parseTagAliases：裁剪与坏项丢弃（按序不连坐）", () => {
  assert.deepEqual(parseTagAliases("nope"), {});
  assert.deepEqual(parseTagAliases(["a", "b"]), {});
  assert.deepEqual(parseTagAliases(null), {});
  assert.deepEqual(parseTagAliases({ " 鳴潮 ": " 鸣潮 " }), { 鳴潮: "鸣潮" }); // 键值都 trim
  assert.deepEqual(parseTagAliases({ a: "", b: null, "": "x" }), {}); // 空键值丢弃
  assert.deepEqual(parseTagAliases({ a: "a" }), {}); // 值 = 键丢弃
  const clamped = parseTagAliases({ ["k".repeat(200)]: "v".repeat(200) });
  const [key, val] = Object.entries(clamped)[0]!;
  assert.equal(key.length, TAG_ALIAS_TEXT_LIMIT);
  assert.equal(val.length, TAG_ALIAS_TEXT_LIMIT);
  const many: Record<string, string> = {};
  for (let i = 0; i < TAG_ALIAS_ENTRY_LIMIT + 50; i += 1) many[`k${i}`] = `v${i}`;
  assert.equal(Object.keys(parseTagAliases(many)).length, TAG_ALIAS_ENTRY_LIMIT); // 超限按序截断
  // 坏项前后夹好项：只丢坏项本身，好项照收
  assert.deepEqual(parseTagAliases({ bad: "bad", 鳴潮: "鸣潮", "": "x" }), { 鳴潮: "鸣潮" });
});

test("parseTagAliases：成链 / 成环条目丢弃（防链第二层）", () => {
  // 值同时是另一键 → 成链：鳴潮→鸣潮 丢，鸣潮→WutheringWaves 留
  assert.deepEqual(
    parseTagAliases({ 鳴潮: "鸣潮", 鸣潮: "WutheringWaves" }),
    { 鸣潮: "WutheringWaves" },
  );
  // 互指成环：两个都是「值 = 另一键」，全丢
  assert.deepEqual(parseTagAliases({ a: "b", b: "a" }), {});
  // 判定看原始键集（与丢弃顺序无关）：b→b 虽被丢，b 仍是原始键，a→b 照丢
  assert.deepEqual(parseTagAliases({ a: "b", b: "b" }), {});
  // 键带边空白的隐性链（trim 后撞上）也丢：输出表自身保证无链
  assert.deepEqual(parseTagAliases({ a: "b", " b ": "c" }), { b: "c" });
});

test("clusterTagVariants：机械变体聚簇、繁简分开、单变体不成簇", () => {
  const items: TagItemLike[] = [
    { tags: ["WutheringWaves"] },
    { tags: ["wutheringwaves"] },
    { tags: ["ＷｕｔｈｅｒｉｎｇＷａｖｅｓ"] }, // 全角与上两条同簇
    { tags: ["Waves"] }, // 键不同（waves），单变体 → 不成簇
    { tags: [] },
    { tags: [" ", 123 as unknown as string] }, // 脏数据不参与
  ];
  const clusters = clusterTagVariants(items);
  assert.deepEqual(
    clusters.map((c) => c.key),
    ["wutheringwaves"], // 只出机械变体簇
  );
  const [waves] = clusters;
  assert.ok(waves);
  assert.equal(waves.totalCount, 3);
  assert.deepEqual(
    waves.variants.map((v) => v.name),
    ["WutheringWaves", "wutheringwaves", "ＷｕｔｈｅｒｉｎｇＷａｖｅｓ"], // 原文保留供挑选；同频按字典序
  );
  // 鳴潮 / 鸣潮 繁简不合（非目标）：各自单变体不成簇，跨语言靠手动归并框
  assert.equal(
    clusterTagVariants([{ tags: ["鳴潮"] }, { tags: ["鳴潮"] }, { tags: ["鸣潮"] }]).length,
    0,
  );
  // 同一作品双变体 / 重复原文：重复只计一次，双变体各计一次
  const [same] = clusterTagVariants([{ tags: ["a", "a", "A"] }]);
  assert.ok(same);
  assert.deepEqual(same.variants, [{ name: "A", count: 1 }, { name: "a", count: 1 }]); // 同频字典序
  assert.equal(same.totalCount, 2);
  assert.equal(clusterTagVariants([{ tags: ["a", "a", "a"] }]).length, 0); // 纯重复不成簇
  // 簇按合计降序、同数按 key 字典序
  assert.deepEqual(
    clusterTagVariants([
      { tags: ["X", "x"] },
      { tags: ["B"] },
      { tags: ["b"] },
      { tags: ["ｂ"] },
    ]).map((c) => c.key),
    ["b", "x"], // 3 > 2
  );
  assert.equal(clusterTagVariants([]).length, 0);
});

test("clusterNeedsAlias：别名套上后簇从待整理列表消失", () => {
  const [cluster] = clusterTagVariants([{ tags: ["WutheringWaves"] }, { tags: ["wutheringwaves"] }]);
  assert.ok(cluster);
  assert.equal(clusterNeedsAlias(cluster), true); // 两写法仍指向两个展示名
  // 归一后只剩一个规范名 → 不再需要整理
  assert.equal(clusterNeedsAlias(cluster, { wutheringwaves: "WutheringWaves" }), false);
  // 只归一半：仍剩两个展示名 → 还要整理
  assert.equal(clusterNeedsAlias(cluster, { wutheringwaves: "别的" }), true);
});

test("tagsAfterRemove：按展示名（归一后）匹配，变体原文一起删、保序", () => {
  const aliases = { 鸣潮: "鳴潮" };
  // 删规范名「鳴潮」：条目上只有变体原文「鸣潮」也命中（M1 语义：变体一起删）
  assert.deepEqual(tagsAfterRemove(["鸣潮", "猫"], "鳴潮", aliases), ["猫"]);
  // 删变体名「鸣潮」：目标先归一成「鳴潮」，两个写法同删
  assert.deepEqual(tagsAfterRemove(["鳴潮", "鸣潮", "猫"], "鸣潮", aliases), ["猫"]);
  // 无命中原样返回 null（调用方跳过写回，不计影响张数）
  assert.equal(tagsAfterRemove(["猫", "狗"], "鳴潮", aliases), null);
  assert.equal(tagsAfterRemove(["猫"], "鳴潮"), null); // 无表精确匹配
  assert.equal(tagsAfterRemove(["鳴潮"], "  ", aliases), null); // 空目标不动
  // 删到剩空数组是合法结果；其余标签保序
  assert.deepEqual(tagsAfterRemove(["猫", "鸣潮", "狗"], "鳴潮", aliases), ["猫", "狗"]);
});

test("tagsAfterAdd：变体输入写规范名原文（不展开变体），已有同展示名不动", () => {
  const aliases = { 鸣潮: "鳴潮" };
  // 输入变体「鸣潮」→ 写规范名「鳴潮」，追加在尾部
  assert.deepEqual(tagsAfterAdd(["猫"], "鸣潮", aliases), ["猫", "鳴潮"]);
  // 输入已是规范名 → 原样写入
  assert.deepEqual(tagsAfterAdd(["猫"], "鳴潮", aliases), ["猫", "鳴潮"]);
  // 已有变体（归一后同展示名）→ 返回 null，不重复写
  assert.equal(tagsAfterAdd(["鸣潮"], "鳴潮", aliases), null);
  assert.equal(tagsAfterAdd(["鳴潮"], "鸣潮", aliases), null);
  // 空白输入不动
  assert.equal(tagsAfterAdd(["猫"], "   ", aliases), null);
  // 边空白的输入 trim 后写入
  assert.deepEqual(tagsAfterAdd(["猫"], " 狗 ", aliases), ["猫", "狗"]);
});
