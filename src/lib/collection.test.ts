/**
 * 手工合集纯函数：parseCollections 双上限/清洗口径、collectionMembers 软失效、
 * moveCollectionItem 重排语义（09-27-collections，design §4.1）。
 *
 * 作用：锁「外部（备份/迁移/同步段）来的合集逐项校验、坏项丢弃、id 去重取首个、
 *       items 保序去重、50×500 双上限截取」与「重排越界 no-op、不改入参」两条线。
 * 为什么：parse 层是设置段膨胀的唯一闸口（手改备份文件也膨胀不了）；
 *        items 不做 key 形态校验是软失效口径的前提——清洗会破坏
 *        「重新收藏同作品自然恢复」。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLLECTION_ITEMS_LIMIT,
  COLLECTION_LIMIT,
  collectionMembers,
  moveCollectionItem,
  parseCollections,
  type Collection,
} from "./collection.ts";

function sample(over: Partial<Collection> & Pick<Collection, "id" | "name">): Collection {
  return { items: [], createdAt: 1, updatedAt: 2, ...over };
}

test("parseCollections：缺字段/非数组/坏项丢弃，好项保留", () => {
  // 缺字段与非数组一律空表，不得是 undefined
  assert.deepEqual(parseCollections(undefined), []);
  assert.deepEqual(parseCollections(null), []);
  assert.deepEqual(parseCollections({}), []);
  assert.deepEqual(parseCollections("junk"), []);
  // 逐项校验：非对象项、缺 id、缺 name（空串/纯空白）都丢，不连坐好项
  const parsed = parseCollections([
    null,
    "junk",
    3,
    {},
    { id: "c1", name: "   " },
    { id: "", name: "没 id" },
    { id: "ok", name: "風景", items: ["pixiv:1"] },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, "ok");
  assert.deepEqual(parsed[0]?.items, ["pixiv:1"]);
});

test("parseCollections：id 去重取首个；name trim 后落库、超长裁 40", () => {
  const parsed = parseCollections([
    { id: "c1", name: "  風景  " },
    { id: "c1", name: "重复的应被丢弃" },
  ]);
  assert.equal(parsed.length, 1, "id 重复取首个");
  assert.equal(parsed[0]?.name, "風景");
  const long = parseCollections([{ id: "c2", name: `  ${"长".repeat(45)}  ` }]);
  assert.equal(long[0]?.name.length, 40, "超长名字裁到 40");
  assert.equal(long[0]?.name, "长".repeat(40));
});

test("parseCollections：items 保序去重，非字符串/空串丢弃，不做 key 形态校验", () => {
  const parsed = parseCollections([
    { id: "c1", name: "風景", items: ["yande:2", "pixiv:1", "yande:2", "", 3, null, "pixiv:1", "loose-key"] },
  ]);
  assert.deepEqual(
    parsed[0]?.items,
    ["yande:2", "pixiv:1", "loose-key"],
    "保序 + 去重；不清洗非 workKey 形态（软失效口径：重新收藏自然恢复）",
  );
});

test("parseCollections：50 合计 × 单合集 500 双上限截取，时间戳脏值落 0", () => {
  // 第 51 个合集丢弃
  const many = Array.from({ length: COLLECTION_LIMIT + 1 }, (_, i) => ({ id: `c${i}`, name: `n${i}`, items: [] }));
  assert.equal(many.length, 51);
  assert.equal(parseCollections(many).length, COLLECTION_LIMIT);
  // 单合集 501 项裁到 500，且保序（前 500 个）
  const big = parseCollections([
    { id: "big", name: "big", items: Array.from({ length: COLLECTION_ITEMS_LIMIT + 1 }, (_, i) => `k${i}`) },
  ]);
  assert.equal(big[0]?.items.length, COLLECTION_ITEMS_LIMIT);
  assert.equal(big[0]?.items[0], "k0");
  assert.equal(big[0]?.items.at(-1), `k${COLLECTION_ITEMS_LIMIT - 1}`);
  // 时间戳缺省/脏值兜底 0，不抛
  const dirty = parseCollections([{ id: "d1", name: "脏", createdAt: "x", updatedAt: NaN }]);
  assert.deepEqual(dirty[0]?.createdAt, 0);
  assert.deepEqual(dirty[0]?.updatedAt, 0);
});

test("parseCollections：coverKey 只在非空字符串时保留", () => {
  assert.equal(parseCollections([{ id: "c1", name: "n", coverKey: "pixiv:1" }])[0]?.coverKey, "pixiv:1");
  assert.equal(parseCollections([{ id: "c1", name: "n", coverKey: "" }])[0]?.coverKey, undefined);
  assert.equal(parseCollections([{ id: "c1", name: "n", coverKey: 3 }])[0]?.coverKey, undefined);
  assert.equal(parseCollections([{ id: "c1", name: "n" }])[0]?.coverKey, undefined);
});

test("collectionMembers：失配 key 过滤、保序；重新收藏同 key 自然恢复", () => {
  const c = sample({ id: "c1", name: "風景", items: ["pixiv:1", "yande:gone", "pixiv:2"] });
  const vaultKeys = new Set(["pixiv:1", "pixiv:2"]);
  // 失配 key（yande:gone）过滤掉，其余保序
  assert.deepEqual(collectionMembers(c, vaultKeys), ["pixiv:1", "pixiv:2"]);
  // 重新收藏同作品：key 回到集合里，失配项自动恢复
  assert.deepEqual(collectionMembers(c, new Set(["pixiv:1", "pixiv:2", "yande:gone"])), [
    "pixiv:1",
    "yande:gone",
    "pixiv:2",
  ]);
  // 全失配 → 空（不自动删合集，渲染层显示空态）
  assert.deepEqual(collectionMembers(c, new Set()), []);
});

test("moveCollectionItem：up/down/top 常规移动", () => {
  assert.deepEqual(moveCollectionItem(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(moveCollectionItem(["a", "b", "c"], "a", "down"), ["b", "a", "c"]);
  assert.deepEqual(moveCollectionItem(["a", "b", "c"], "c", "top"), ["c", "a", "b"]);
  assert.deepEqual(moveCollectionItem(["a", "b", "c"], "a", "top"), ["a", "b", "c"]);
});

test("moveCollectionItem：越界 no-op（首项上移/末项下移/未命中），但返回新数组", () => {
  const items = ["a", "b", "c"];
  assert.deepEqual(moveCollectionItem(items, "a", "up"), ["a", "b", "c"], "首项上移原样");
  assert.deepEqual(moveCollectionItem(items, "c", "down"), ["a", "b", "c"], "末项下移原样");
  assert.deepEqual(moveCollectionItem(items, "没这个", "top"), ["a", "b", "c"], "未命中原样");
  // 原样返回也得是新数组：调用方（setState）靠引用变化感知
  for (const action of ["up", "down", "top"] as const) {
    const next = moveCollectionItem(items, "a", action);
    assert.notEqual(next, items, `no-op 也返回新数组（action=${action}）`);
  }
});

test("moveCollectionItem：软失效的 key 留在原位，只在看得到的成员之间换", () => {
  const present = new Set(["a", "b", "c"]);
  assert.deepEqual(
    moveCollectionItem(["a", "gone", "b"], "a", "down", present),
    ["b", "gone", "a"],
    "下移越过藏起来的 key，跟下一张可见的换",
  );
  assert.deepEqual(
    moveCollectionItem(["a", "h1", "h2", "b"], "a", "down", present),
    ["b", "h1", "h2", "a"],
    "连续多个隐藏项也不挪动",
  );
  assert.deepEqual(moveCollectionItem(["a", "gone", "b"], "b", "up", present), ["b", "gone", "a"]);
  assert.deepEqual(
    moveCollectionItem(["gone", "a", "h2", "b"], "b", "top", present),
    ["gone", "b", "h2", "a"],
    "置顶落到第一张可见的位置",
  );
  assert.deepEqual(
    moveCollectionItem(["gone", "a", "b"], "a", "up", present),
    ["gone", "a", "b"],
    "已经是第一张可见的，上移不动前面的隐藏项",
  );
  assert.deepEqual(moveCollectionItem(["a", "gone"], "a", "down", present), ["a", "gone"], "后面没有可见的，下移 no-op");
  assert.deepEqual(moveCollectionItem(["a", "gone", "b"], "gone", "down", present), ["a", "gone", "b"], "藏起来的 key 自己不参与");
  // 不传 present：每一项都参与，原先后邻对调还在
  assert.deepEqual(moveCollectionItem(["a", "gone", "b"], "a", "down"), ["gone", "a", "b"]);
  const items = ["a", "gone", "b"];
  const next = moveCollectionItem(items, "a", "down", present);
  assert.notEqual(next, items, "返回新数组");
  assert.deepEqual(items, ["a", "gone", "b"], "入参顺序不变");
});

test("moveCollectionItem：不改入参", () => {
  const items = ["a", "b", "c"];
  const frozen: readonly string[] = Object.freeze([...items]);
  moveCollectionItem(frozen, "c", "top");
  moveCollectionItem(frozen, "b", "up");
  moveCollectionItem(frozen, "没这个", "down");
  assert.deepEqual(items, ["a", "b", "c"], "入参顺序不变");
});
