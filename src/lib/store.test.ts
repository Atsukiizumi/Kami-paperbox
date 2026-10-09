/**
 * refreshIdentities 失败提示回归（SWALLOW）+ persist v11→v12 标签别名迁移。
 *
 * 作用：锁住「whoami 非 200 / 网络异常必须弹用户可见 toast（固定 id）」与
 *       「成功路径零 toast、照常回填身份」两条线；以及「老档升级不丢已有
 *       字段、tagAliases 缺省补空表」「setTagAliasCluster 防链 / 满员守卫」。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { toast } from "sonner";
import { COLLECTION_ITEMS_LIMIT, COLLECTION_LIMIT, type Collection } from "./collection.ts";
import { IDENTITY_REFRESH_TOAST_ID, migrateSettings, useSettings } from "./store.ts";
import { TAG_ALIAS_ENTRY_LIMIT } from "./vault-tag-alias.ts";

type ErrCall = { message: unknown; options: { id?: string } | undefined };

function stubToastErrors() {
  const calls: ErrCall[] = [];
  const original = toast.error;
  toast.error = ((message: unknown, options?: { id?: string }) => {
    calls.push({ message, options });
    return undefined as unknown as string | number;
  }) as typeof toast.error;
  return {
    calls,
    restore() {
      toast.error = original;
    },
  };
}

const PIXIV_SESSION = "12345678_ABCDEFGH";

function resetStore() {
  useSettings.setState({
    pixivCookie: "",
    fanboxCookie: "",
    accounts: [],
    activeAccountId: null,
  });
}

test("whoami 非 200 时弹固定 id 的失败提示，不回填身份", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  resetStore();
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  try {
    await useSettings.getState().refreshIdentities();
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.equal(stub.calls.length, 1, "失败必须提示一次");
  assert.match(String(stub.calls[0]?.message), /站点身份获取失败/);
  assert.equal(stub.calls[0]?.options?.id, IDENTITY_REFRESH_TOAST_ID, "固定 id 防刷屏");
});

test("whoami 网络异常时弹固定 id 的失败提示", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  resetStore();
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  try {
    await useSettings.getState().refreshIdentities();
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.equal(stub.calls.length, 1, "网络异常也必须提示，不再静默吞掉");
  assert.equal(stub.calls[0]?.options?.id, IDENTITY_REFRESH_TOAST_ID, "固定 id 防刷屏");
});

test("whoami 200 时不弹提示，身份照常回填", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ pixiv: { id: "12345678", name: "墨纸" }, fanbox: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  resetStore();
  const accId = useSettings.getState().addAccount("测试");
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  try {
    await useSettings.getState().refreshIdentities();
    const account = useSettings.getState().accounts.find((a) => a.id === accId);
    assert.equal(useSettings.getState().activeAccountId, accId, "当前账号不漂移");
    assert.equal(account?.pixivProfile?.name, "墨纸", "回填的身份应落在当前账号上");
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.deepEqual(stub.calls, [], "成功路径必须保持静默");
});

test("switchAccount 时会话写入失败弹固定 id 提示，不产生未处理拒绝", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  resetStore();
  useSettings.getState().addAccount("甲");
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  const 乙 = useSettings.getState().addAccount("乙");
  try {
    await useSettings.getState().switchAccount(乙);
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.equal(stub.calls.length, 1, "切换账号的会话写入失败必须提示");
  assert.equal(stub.calls[0]?.options?.id, "kami-session-sync", "与登录流程共用固定 id");
});

test("persist v11→v12：tagAliases 缺省补空表，老档已有字段一个不丢", () => {
  // v11 老档：整个载荷没有 tagAliases 字段
  const v11 = migrateSettings(
    {
      pixivCookie: PIXIV_SESSION,
      folderLabel: "Kami",
      smartFolders: [{ id: "f1", name: "心头好", query: { tags: ["1girl"] } }],
      authorAliases: { あいす: "アイス" },
      lastBackupAt: 1_800_000_000_000,
    },
    11,
  ) as Record<string, unknown>;
  assert.deepEqual(v11.tagAliases, {}, "缺字段补默认空表，不得是 undefined");
  assert.deepEqual(v11.authorAliases, { あいす: "アイス" }, "老档已有字段保留");
  assert.equal(v11.folderLabel, "Kami");
  assert.equal((v11.smartFolders as unknown[]).length, 1);
  assert.equal(v11.lastBackupAt, 1_800_000_000_000);
  // v12 新档自带 tagAliases：经 parseTagAliases 裁剪（脏项丢、好项留）
  const v12 = migrateSettings(
    { tagAliases: { " 鳴潮 ": " 鸣潮 ", bad: "bad" }, authorAliases: { a: "b" } },
    12,
  ) as Record<string, unknown>;
  assert.deepEqual(v12.tagAliases, { 鳴潮: "鸣潮" }); // 键值 trim、值=键丢
  assert.deepEqual(v12.authorAliases, { a: "b" });
  // 成链条目丢：鳴潮→鸣潮 撞上键「鸣潮」
  const chained = migrateSettings(
    { tagAliases: { 鳴潮: "鸣潮", 鸣潮: "WutheringWaves" } },
    12,
  ) as Record<string, unknown>;
  assert.deepEqual(chained.tagAliases, { 鸣潮: "WutheringWaves" });
  // 空档兜底也有空表
  assert.deepEqual((migrateSettings(null, 0) as Record<string, unknown>).tagAliases, {});
});

test("setTagAliasCluster：整簇写入并撤以规范名为键的旧条目（防链）", () => {
  const before = useSettings.getState().tagAliases;
  try {
    useSettings.setState({ tagAliases: { 鸣潮: "WutheringWaves" } });
    // 落簇：鳴潮 / 鸣潮 → 鸣潮。先撤「鸣潮→WutheringWaves」（规范名自身
    // 不能再是变体），否则并存成 A→B→C 链
    useSettings.getState().setTagAliasCluster(["鳴潮", "鸣潮", "  "], "鸣潮");
    assert.deepEqual(useSettings.getState().tagAliases, { 鳴潮: "鸣潮" });
    // 空规范名整体拒绝，表不动
    useSettings.getState().setTagAliasCluster(["别的"], "   ");
    assert.deepEqual(useSettings.getState().tagAliases, { 鳴潮: "鸣潮" });
    // removeTagAlias 只删一条，其余不动
    useSettings.getState().removeTagAlias("鳴潮");
    assert.deepEqual(useSettings.getState().tagAliases, {});
    useSettings.getState().removeTagAlias("不存在的");
    assert.deepEqual(useSettings.getState().tagAliases, {});
  } finally {
    useSettings.setState({ tagAliases: before });
  }
});

test("setTagAliasCluster 满员守卫：新键不进表、已有键照常改写", () => {
  const before = useSettings.getState().tagAliases;
  const full: Record<string, string> = {};
  for (let i = 0; i < TAG_ALIAS_ENTRY_LIMIT; i += 1) full[`变体${i}`] = `规范${i}`;
  try {
    useSettings.setState({ tagAliases: full });
    useSettings.getState().setTagAliasCluster(["新变体", "变体0"], "目标");
    const after = useSettings.getState().tagAliases;
    assert.equal(Object.keys(after).length, TAG_ALIAS_ENTRY_LIMIT, "不得超限");
    assert.equal(after.新变体, undefined, "满员后新键按序丢弃");
    assert.equal(after.变体0, "目标", "已有键照常改写");
  } finally {
    useSettings.setState({ tagAliases: before });
  }
});

test("persist v12→v13：safeMode 广播成 safeModeBySite，缺站点回安全侧", () => {
  // v12 老档：只有全局 safeMode=false（R-18 全开）→ 五站全开
  const legacy = migrateSettings({ safeMode: false }, 12) as Record<string, unknown>;
  assert.deepEqual(legacy.safeModeBySite, {
    pixiv: false,
    fanbox: false,
    yande: false,
    konachan: false,
    danbooru: false,
  });
  // v13 新档：记录部分站点 → 缺的站点回安全侧
  const partial = migrateSettings({ safeModeBySite: { pixiv: false } }, 13) as Record<string, unknown>;
  assert.deepEqual(partial.safeModeBySite, {
    pixiv: false,
    fanbox: true,
    yande: true,
    konachan: true,
    danbooru: true,
  });
  // 脏值当缺省：回退到旧全局 safeMode（true → 安全侧）
  const dirty = migrateSettings({ safeModeBySite: { pixiv: "no" }, safeMode: true }, 13) as Record<string, unknown>;
  assert.equal((dirty.safeModeBySite as Record<string, boolean>).pixiv, true);
  assert.deepEqual((migrateSettings(null, 0) as Record<string, unknown>).safeModeBySite, {
    pixiv: true,
    fanbox: true,
    yande: true,
    konachan: true,
    danbooru: true,
  });
});

test("setSafeModeFor 只动指定站点，其余站点不受牵连", () => {
  const before = useSettings.getState().safeModeBySite;
  try {
    useSettings.setState({ safeModeBySite: { pixiv: true, fanbox: true, yande: true, konachan: true, danbooru: true } });
    useSettings.getState().setSafeModeFor("pixiv", false);
    assert.deepEqual(useSettings.getState().safeModeBySite, {
      pixiv: false,
      fanbox: true,
      yande: true,
      konachan: true,
      danbooru: true,
    });
    useSettings.getState().setSafeModeFor("pixiv", true);
    assert.equal(useSettings.getState().safeModeBySite.pixiv, true);
  } finally {
    useSettings.setState({ safeModeBySite: before });
  }
});

test("persist v13→v14：watchTags 缺省补空表，脏项丢弃、同词去重、超限截取", () => {
  // v13 老档：没有 watchTags 字段
  const v13 = migrateSettings({ folderLabel: "Kami" }, 13) as Record<string, unknown>;
  assert.deepEqual(v13.watchTags, [], "缺字段补默认空表，不得是 undefined");
  assert.equal(v13.folderLabel, "Kami", "老档已有字段保留");
  // v14 新档：经 parseWatchTags 裁剪（坏项丢、同站同词去重）
  const v14 = migrateSettings(
    {
      watchTags: [
        { source: "pixiv", tag: " 鳴潮 ", addedAt: 1 },
        { source: "pixiv", tag: "鳴潮", addedAt: 2 },
        { source: "fanbox", tag: "x", addedAt: 3 },
      ],
    },
    14,
  ) as Record<string, unknown>;
  assert.deepEqual((v14.watchTags as { source: string; tag: string }[]).map((t) => t.tag), ["鳴潮"]);
  // 空档兜底
  assert.deepEqual((migrateSettings(null, 0) as Record<string, unknown>).watchTags, []);
});

test("toggleWatchTag：加/去重/满员；setWatchTagSeen 推进水位只动目标", () => {
  const before = useSettings.getState().watchTags;
  try {
    useSettings.setState({ watchTags: [] });
    assert.equal(useSettings.getState().toggleWatchTag("pixiv", " 鳴潮 "), "added");
    assert.equal(useSettings.getState().toggleWatchTag("pixiv", "鳴潮"), "removed", "同词（trim+小写）再点即取消");
    useSettings.getState().toggleWatchTag("yande", "Nagi");
    assert.equal(useSettings.getState().toggleWatchTag("yande", "nagi"), "removed", "同词（大小写不敏感）再点即取消");
    useSettings.getState().toggleWatchTag("yande", "Nagi"); // 重新加上
    assert.equal(useSettings.getState().watchTags.length, 1);
    useSettings.getState().setWatchTagSeen("yande", "Nagi", "42");
    assert.equal(useSettings.getState().watchTags.find((t) => t.source === "yande")?.lastSeenId, "42");
    // 满员守卫
    const full = Array.from({ length: 30 }, (_, i) => ({ source: "pixiv" as const, tag: `t${i}`, addedAt: i }));
    useSettings.setState({ watchTags: full });
    assert.equal(useSettings.getState().toggleWatchTag("pixiv", "新词"), "full");
    assert.equal(useSettings.getState().watchTags.length, 30, "满员不进列");
  } finally {
    useSettings.setState({ watchTags: before });
  }
});

// ── 手工合集（09-27-collections）：persist v14→v15 迁移 + 七个 setter 守卫 ──

function collectionFixture(i: number, over: Partial<Collection> = {}): Collection {
  return { id: `c${i}`, name: `n${i}`, items: [], createdAt: i, updatedAt: i, ...over };
}

test("persist v14→v15：collections 缺省补空表，脏项丢弃、id 去重、items 保序去重", () => {
  // v14 老档：没有 collections 字段
  const v14 = migrateSettings(
    { folderLabel: "Kami", watchTags: [{ source: "pixiv", tag: "鳴潮", addedAt: 1 }] },
    14,
  ) as Record<string, unknown>;
  assert.deepEqual(v14.collections, [], "缺字段补默认空表，不得是 undefined");
  assert.equal(v14.folderLabel, "Kami", "老档已有字段保留");
  assert.deepEqual((v14.watchTags as { tag: string }[]).map((t) => t.tag), ["鳴潮"], "v14 已有字段迁移不丢");
  // v15 新档：经 parseCollections 裁剪（坏项丢、id 去重取首个、items 保序去重）
  const v15 = migrateSettings(
    {
      collections: [
        { id: "c1", name: " 風景 ", items: ["pixiv:1", "pixiv:1", "", 3, "yande:2"], createdAt: 1, updatedAt: 2 },
        { id: "c1", name: "重复的应被丢弃", items: [] },
        { name: "没 id" },
      ],
    },
    15,
  ) as Record<string, unknown>;
  const cols = v15.collections as Collection[];
  assert.equal(cols.length, 1, "坏项/重复 id 丢弃");
  assert.equal(cols[0]?.name, "風景");
  assert.deepEqual(cols[0]?.items, ["pixiv:1", "yande:2"]);
  // 双上限：51 个合集只进前 50；排头的 501 项合集自身裁到 500
  const capped = migrateSettings(
    {
      collections: [
        { id: "big", name: "big", items: Array.from({ length: COLLECTION_ITEMS_LIMIT + 1 }, (_, i) => `k${i}`) },
        ...Array.from({ length: COLLECTION_LIMIT + 1 }, (_, i) => collectionFixture(i)),
      ],
    },
    15,
  ) as Record<string, unknown>;
  const cappedCols = capped.collections as Collection[];
  assert.equal(cappedCols.length, COLLECTION_LIMIT, "合计上限 50，第 51 个起丢弃");
  assert.equal(cappedCols[0]?.name, "big");
  assert.equal(cappedCols[0]?.items.length, COLLECTION_ITEMS_LIMIT, "单合集上限 500");
  // 空档兜底也有空表
  assert.deepEqual((migrateSettings(null, 0) as Record<string, unknown>).collections, []);
});

test("createCollection：成功 trim 落库；空名拒、第 51 个拒；renameCollection 空名不改", () => {
  const before = useSettings.getState().collections;
  try {
    useSettings.setState({ collections: [] });
    const created = useSettings.getState().createCollection("  心头好  ", ["pixiv:1", "yande:2"]);
    if (!created.ok) throw new Error("有名字就该建成功");
    const saved = useSettings.getState().collections.find((c) => c.id === created.id);
    assert.equal(saved?.name, "心头好", "trim 后落库");
    assert.deepEqual(saved?.items, ["pixiv:1", "yande:2"], "建时可带初始成员");
    assert.ok((saved?.updatedAt ?? 0) > 0, "时间戳落库");
    // 空名拒：表不动
    assert.deepEqual(useSettings.getState().createCollection("   "), { ok: false, reason: "name" });
    assert.equal(useSettings.getState().collections.length, 1);
    // 重命名：trim 落库、空名不改
    useSettings.getState().renameCollection(created.id, "  改名  ");
    assert.equal(useSettings.getState().collections[0]?.name, "改名");
    const snap = useSettings.getState().collections[0];
    useSettings.getState().renameCollection(created.id, "   ");
    assert.deepEqual(useSettings.getState().collections[0], snap, "空名不改（对象原样）");
    // 满额守卫：第 51 个被拒
    const full = Array.from({ length: COLLECTION_LIMIT }, (_, i) => collectionFixture(i));
    useSettings.setState({ collections: full });
    assert.deepEqual(useSettings.getState().createCollection("新合集"), { ok: false, reason: "full" });
    assert.equal(useSettings.getState().collections.length, COLLECTION_LIMIT, "满额不进列");
  } finally {
    useSettings.setState({ collections: before });
  }
});

test("addToCollection：重复 key 不占容量、超 500 整批拒不做部分写入", () => {
  const before = useSettings.getState().collections;
  try {
    // 499 项的合集：去重后只加 1 个新 key → 499+1=500 恰好贴线
    const base = Array.from({ length: COLLECTION_ITEMS_LIMIT - 1 }, (_, i) => `k${i}`);
    useSettings.setState({ collections: [collectionFixture(0, { id: "big", name: "big", items: base })] });
    assert.equal(useSettings.getState().addToCollection("big", ["k0", "new1"]), 1, "已有 key 不占容量");
    assert.equal(useSettings.getState().collections[0]?.items.length, COLLECTION_ITEMS_LIMIT);
    // 已满：再贴上限的增量也整批拒——重复 key 不占位再算容量，仍是 full
    const snapshot = useSettings.getState().collections[0];
    assert.equal(useSettings.getState().addToCollection("big", ["k0", "z"]), "full");
    assert.deepEqual(useSettings.getState().collections[0], snapshot, "整批拒绝：对象原样（含 updatedAt 不刷）");
    // 全是已有 key：no-op 返回 0
    assert.equal(useSettings.getState().addToCollection("big", ["k0", "k1"]), 0);
    // 集合 id 未命中：返回 0
    assert.equal(useSettings.getState().addToCollection("没有的", ["k"]), 0);
  } finally {
    useSettings.setState({ collections: before });
  }
});

test("setCollectionCover：非成员 key 拒、重复设 no-op、undefined 清除字段", () => {
  const before = useSettings.getState().collections;
  try {
    useSettings.setState({
      collections: [collectionFixture(1, { items: ["pixiv:1", "pixiv:2"] })],
    });
    // 非成员 key 拒（PRD C4「从成员中选」）
    const empty = useSettings.getState().collections[0];
    useSettings.getState().setCollectionCover("c1", "pixiv:9");
    assert.deepEqual(useSettings.getState().collections[0], empty, "非成员 key 拒：对象原样");
    // 成员 key 落库
    useSettings.getState().setCollectionCover("c1", "pixiv:1");
    assert.equal(useSettings.getState().collections[0]?.coverKey, "pixiv:1");
    // 重复设同封面：no-op 不刷 updatedAt
    const snap = useSettings.getState().collections[0];
    useSettings.getState().setCollectionCover("c1", "pixiv:1");
    assert.deepEqual(useSettings.getState().collections[0], snap);
    // undefined 清除显式封面（字段缺席，不是 undefined 残留）
    useSettings.getState().setCollectionCover("c1", undefined);
    const cleared = useSettings.getState().collections[0] as Collection;
    assert.equal("coverKey" in cleared, false, "清除后字段缺席");
    assert.deepEqual(cleared.items, ["pixiv:1", "pixiv:2"], "items 不动");
  } finally {
    useSettings.setState({ collections: before });
  }
});

test("removeFromCollection / reorderCollectionItem：未命中 no-op；重排走纯函数；removeCollection 只删清单", () => {
  const before = useSettings.getState().collections;
  try {
    useSettings.setState({ collections: [collectionFixture(1, { items: ["a", "b", "c"] })] });
    // 移除未命中 key / 集合未命中：no-op
    const snap = useSettings.getState().collections[0];
    useSettings.getState().removeFromCollection("c1", "没这个");
    assert.deepEqual(useSettings.getState().collections[0], snap);
    useSettings.getState().removeFromCollection("没有的", "a");
    assert.deepEqual(useSettings.getState().collections, [snap]);
    // 移除命中：其余保序
    useSettings.getState().removeFromCollection("c1", "b");
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["a", "c"]);
    // 重排未命中：no-op；命中：置顶语义来自 moveCollectionItem
    useSettings.getState().reorderCollectionItem("c1", "没这个", "top");
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["a", "c"]);
    useSettings.getState().reorderCollectionItem("c1", "c", "top");
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["c", "a"]);
    useSettings.getState().reorderCollectionItem("c1", "c", "up");
    assert.deepEqual(useSettings.getState().collections[0]?.items, ["c", "a"], "首项上移 no-op");
    useSettings.setState({ collections: [collectionFixture(1, { items: ["a", "gone", "b"] })] });
    useSettings.getState().reorderCollectionItem("c1", "a", "down", new Set(["a", "b"]));
    assert.deepEqual(
      useSettings.getState().collections[0]?.items,
      ["b", "gone", "a"],
      "setter 把看得到的成员传给纯函数，软失效 key 留在原下标",
    );
    // removeCollection 只删清单不动藏品：目标消失，其余不牵连
    useSettings.setState({ collections: [collectionFixture(1), collectionFixture(2)] });
    useSettings.getState().removeCollection("c1");
    assert.deepEqual(useSettings.getState().collections.map((c) => c.id), ["c2"]);
  } finally {
    useSettings.setState({ collections: before });
  }
});
