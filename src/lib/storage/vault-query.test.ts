import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterVaultItems,
  haystackOf,
  parseSmartFolders,
  vaultAuthorOptions,
  vaultAuthors,
  vaultMonths,
  vaultTags,
  vaultTotals,
} from "./vault-query.ts";
import { authorKey } from "../author-name.ts";
import type { VaultMeta } from "../types.ts";

function item(over: Partial<VaultMeta> & Pick<VaultMeta, "key" | "title" | "author">): VaultMeta {
  return {
    source: "pixiv",
    id: over.id ?? over.key,
    authorId: "",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 100,
    ...over,
  };
}

test("filterVaultItems matches title author tags and folder path", () => {
  const rows = [
    item({ key: "pixiv:1", title: "Syring the Bikini", author: "_AGOTO", tags: ["Agoto", "OC"], relativePath: "Agoto/2026-08-31/syring.png" }),
    item({ key: "yande:9", source: "yande", title: "無題", author: "zero", tags: ["VOCALOID"], folderLabel: "插画" }),
  ];
  assert.equal(filterVaultItems(rows, { text: "bikini" }).length, 1);
  assert.equal(filterVaultItems(rows, { text: "agoto oc" }).length, 1);
  assert.equal(filterVaultItems(rows, { source: "yande" })[0]?.key, "yande:9");
  assert.equal(filterVaultItems(rows, { text: "vocaloid" }).length, 1);
  assert.equal(filterVaultItems(rows, { text: "2026-08-31" }).length, 1);
  assert.equal(filterVaultItems(rows, { author: "zero" }).length, 1);
  assert.equal(filterVaultItems(rows, { text: "missing" }).length, 0);
});

test("vaultAuthors and totals", () => {
  const rows = [
    item({ key: "a", title: "a", author: "zero", bytes: 10 }),
    item({ key: "b", title: "b", author: "zero", bytes: 15 }),
    item({ key: "c", title: "c", author: "_AGOTO", bytes: 5 }),
  ];
  assert.deepEqual(vaultAuthors(rows), ["_AGOTO", "zero"]);
  assert.deepEqual(vaultTotals(rows), { count: 3, bytes: 30 });
});

test("作者口径走簇键：装饰变体合并计数，authorKey 筛选命中同簇（画师整理）", () => {
  const rows = [
    item({ key: "a", title: "a", author: "☆あいす★", authorId: "", bytes: 10 }),
    item({ key: "b", title: "b", author: "あいす", authorId: "", bytes: 5 }), // 无 id：规范化归一
    item({ key: "c", title: "c", author: "アイス", authorId: "11", bytes: 5 }), // 有 id：独立簇
  ];
  const options = vaultAuthorOptions(rows);
  assert.deepEqual(
    options.map((o) => [o.name, o.count]),
    [["あいす", 2], ["アイス", 1]],
  );
  // 别名把「あいす」并到「アイス」：两个簇展示名合并（键仍分开，计数不串）
  assert.deepEqual(
    vaultAuthorOptions(rows, { あいす: "アイス" }).map((o) => o.name),
    ["アイス", "アイス"],
  );
  // authorKey 筛选：选あいす簇 → 命中两条装饰变体；旧 author 精确匹配仍可用
  const aisKey = authorKey(rows[0]!);
  assert.equal(filterVaultItems(rows, { authorKey: aisKey }).length, 2);
  assert.equal(filterVaultItems(rows, { author: "あいす" }).length, 1);
  // 同 authorId 双名称归一成一条选项
  const renamed = [
    item({ key: "d", title: "d", author: "user", authorId: "7", savedAt: 100 }),
    item({ key: "e", title: "e", author: "☆user★@pixiv", authorId: "7", savedAt: 200 }),
  ];
  assert.deepEqual(vaultAuthorOptions(renamed).map((o) => [o.name, o.count]), [["user", 2]]);
});

test("tags 任一命中；month 按 savedAt 本地年月；与既有谓词叠加（智能库）", () => {
  const rows = [
    item({ key: "a", title: "a", author: "zero", tags: ["landscape", "sky"], savedAt: new Date(2026, 7, 15).getTime() }),
    item({ key: "b", title: "b", author: "zero", tags: ["portrait"], savedAt: new Date(2026, 8, 2).getTime() }),
    item({ key: "c", title: "c", author: "_AGOTO", tags: ["sky"], savedAt: new Date(2025, 11, 30).getTime() }),
  ];
  assert.equal(filterVaultItems(rows, { tags: ["sky"] }).length, 2);
  assert.equal(filterVaultItems(rows, { tags: ["sky", "portrait"] }).length, 3); // 任一命中
  assert.equal(filterVaultItems(rows, { tags: ["nope"] }).length, 0);
  assert.equal(filterVaultItems(rows, { month: "2026-08" })[0]?.key, "a");
  assert.equal(filterVaultItems(rows, { month: "2026-09" })[0]?.key, "b");
  assert.equal(filterVaultItems(rows, { month: "2025-12" })[0]?.key, "c");
  assert.equal(filterVaultItems(rows, { author: "zero", tags: ["portrait"], month: "2026-09" })[0]?.key, "b");
  assert.equal(filterVaultItems(rows, { author: "_AGOTO", tags: ["portrait"] }).length, 0);
});

test("vaultTags 与 vaultMonths 派生选项列表", () => {
  const rows = [
    item({ key: "a", title: "a", author: "z", tags: ["sky", "sky", "night"], savedAt: new Date(2026, 7, 1).getTime() }),
    item({ key: "b", title: "b", author: "z", tags: ["sky"], savedAt: new Date(2026, 8, 1).getTime() }),
  ];
  assert.deepEqual(vaultTags(rows), ["sky", "night"]);
  assert.deepEqual(vaultMonths(rows), ["2026-09", "2026-08"]); // 新月在前
});

test("标签别名（标签整理）：vaultTags 归一聚合，变体并入规范名合并计数", () => {
  const rows = [
    item({ key: "a", title: "a", author: "z", tags: ["鳴潮"] }),
    item({ key: "b", title: "b", author: "z", tags: ["WutheringWaves"] }),
    item({ key: "c", title: "c", author: "z", tags: ["鸣潮", "鳴潮"] }), // 同图双变体，原文各计一次
    item({ key: "d", title: "d", author: "z", tags: ["sky"] }),
  ];
  const aliases = { 鳴潮: "鸣潮", WutheringWaves: "鸣潮" };
  // 五变体例收敛成一个「鸣潮」（4 次）压过 sky（1 次）；筛标签纸同物只剩一笺
  assert.deepEqual(vaultTags(rows, aliases), ["鸣潮", "sky"]);
  // 不带别名表 → 恒等映射，旧口径原样
  assert.deepEqual(vaultTags(rows), ["鳴潮", "WutheringWaves", "sky", "鸣潮"]);
});

test("标签别名（标签整理）：filterVaultItems 双侧归一，存量变体条件与新规范名条件互相命中", () => {
  const rows = [
    item({ key: "a", title: "a", author: "z", tags: ["鳴潮"] }),
    item({ key: "b", title: "b", author: "z", tags: ["WutheringWaves"] }),
    item({ key: "c", title: "c", author: "z", tags: ["鸣潮"] }),
    item({ key: "d", title: "d", author: "z", tags: ["sky"] }),
  ];
  const q = { tagAliases: { 鳴潮: "鸣潮", WutheringWaves: "鸣潮" } };
  // 新条件存规范名（tagOptions 已归一）→ 命中带变体原文的条目
  assert.deepEqual(filterVaultItems(rows, { tags: ["鸣潮"], ...q }).map((r) => r.key), ["a", "b", "c"]);
  // 存量智能库存的是变体原文 → 双侧归一后同样命中规范名条目（无需迁移）
  assert.equal(filterVaultItems(rows, { tags: ["鳴潮"], ...q }).length, 3);
  assert.equal(filterVaultItems(rows, { tags: ["WutheringWaves"], ...q }).length, 3);
  // 别名表只动映射到的变体；无关标签不受影响
  assert.deepEqual(filterVaultItems(rows, { tags: ["sky"], ...q }).map((r) => r.key), ["d"]);
  // 不带别名表 → 旧口径精确匹配
  assert.equal(filterVaultItems(rows, { tags: ["鳴潮"] }).length, 1);
});

test("标签别名（标签整理）：haystackOf 标签段归一，搜规范名命中变体原文", () => {
  const only = item({ key: "a", title: "无题", author: "z", tags: ["鳴潮"] });
  const aliases = { 鳴潮: "鸣潮" };
  // 藏品只带「鳴潮」原文：搜「鸣潮」命中（haystack 里标签段已过别名）
  assert.ok(haystackOf(only, aliases).includes("鸣潮"));
  assert.equal(filterVaultItems([only], { text: "鸣潮", tagAliases: aliases }).length, 1);
  // 归一是单向的：搜变体原文不再命中（搜索进入规范名域，与展示口径一致）
  assert.equal(filterVaultItems([only], { text: "鳴潮", tagAliases: aliases }).length, 0);
  // 不带别名表 → 标签段保留原文（旧口径）
  assert.ok(haystackOf(only).includes("鳴潮"));
  assert.ok(!haystackOf(only).includes("鸣潮"));
});

test("parseSmartFolders 往返 + 脏数据丢弃", () => {
  const folders = [
    { id: "f1", name: "风景", query: { tags: ["landscape", "sky"], month: "2026-08" } },
    { id: "f2", name: "画师X", query: { author: "zero", source: "pixiv", text: "海" } },
  ];
  const back = parseSmartFolders(JSON.parse(JSON.stringify(folders)));
  assert.deepEqual(back, folders);
  assert.equal(parseSmartFolders("nope").length, 0);
  assert.equal(parseSmartFolders([{ id: "", name: "x", query: {} }, { id: "a", name: " ", query: {} }, "junk"]).length, 0);
  assert.deepEqual(parseSmartFolders([{ id: "a", name: "n", query: { month: "2026-13" } }]), [
    { id: "a", name: "n", query: {} },
  ]);
});
