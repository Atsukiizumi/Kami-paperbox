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
import type { Account } from "./sync/accounts.ts";
import { COLLECTION_ITEMS_LIMIT, COLLECTION_LIMIT, type Collection } from "./collection.ts";
import {
  IDENTITY_REFRESH_TOAST_ID,
  SETTINGS_PERSIST_FIELDS,
  cookiesFromSettings,
  migrateSettings,
  partializeSettings,
  useSettings,
} from "./store.ts";
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

// ── X 设置段（10-17-x-account-link M4）：persist v15→v16 迁移 + setter + 凭据组装 ──

const X_TOKEN = "a".repeat(40);
const X_CT0 = "b".repeat(40);
const X_OK = `auth_token=${X_TOKEN}; ct0=${X_CT0}`;

function resetXState() {
  useSettings.setState({ xCookie: "", xAssociations: {}, xGraphQLQueryIds: {} });
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

test("persist v17→v18：案头/外壳/页参数缺省补默认，老档字段一个不丢；脏值过白名单清洗", () => {  const v17 = migrateSettings(
    {
      pixivCookie: PIXIV_SESSION,
      motionEnabled: false,
      lastBackupAt: 1_800_000_000_000,
    },
    17,
  ) as Record<string, unknown>;
  const desk = v17.deskPresets as { id: string; builtIn?: boolean }[];
  assert.equal(desk.length, 2, "缺字段补内置稿纸+编辑式");
  assert.equal(desk[0]?.id, "kami-default");
  assert.ok(desk[0]?.builtIn);
  assert.equal(desk[1]?.id, "kami-editorial", "编辑式内置第二");
  assert.equal(v17.activeDeskPresetId, "kami-default");
  assert.deepEqual(v17.shell, { form: "desk", tweaks: {} });
  assert.deepEqual(v17.pageLayout, { density: "medium", vaultCol: "medium" });
  assert.equal(v17.motionEnabled, false, "v17 既有字段保留");
  assert.equal(v17.lastBackupAt, 1_800_000_000_000);
  // v18 新档带脏值：非法形态整段回默认、越权旋钮脱落、页参数越界回 medium
  const v18 = migrateSettings(
    {
      shell: { form: "cockpit", tweaks: { iconSize: "lg" } },
      pageLayout: { density: "spacy" },
      deskPresets: [{ id: "p1", name: "夜读", layout: { slots: [{ span: 9, items: ["ghost"] }] } }],
    },
    18,
  ) as Record<string, unknown>;
  assert.deepEqual(v18.shell, { form: "desk", tweaks: {} }, "非法形态整段回默认");
  assert.deepEqual(v18.pageLayout, { density: "medium", vaultCol: "medium" });
  const cleaned = v18.deskPresets as { id: string; layout: { slots: { span: number; items: string[] }[] } }[];
  assert.equal(cleaned.length, 3, "内置两条 + 清洗后的夜读");
  // 槽里模块全未知 → 空槽剪枝 → 全空回默认稿纸槽（案头不能空）；夜读排第三（内置稿纸/编辑式在前）
  assert.deepEqual(
    cleaned[2]?.layout.slots,
    [
      { span: 2, items: ["browse-sheet"] },
      { span: 1, items: ["letters", "stack", "artist-wall"] },
      { span: 3, items: ["newspaper"] },
    ],
  );
});

test("案头版式 setters：内置稿纸不可写、另存即激活、满员拒、删激活回稿纸", () => {
  const before = useSettings.getState();
  const custom: Parameters<typeof before.setDeskLayout>[0] = {
    slots: [
      { span: 3, items: ["newspaper"] },
      { span: 2, items: ["browse-sheet"] },
    ],
    headerSlip: false,
  };
  try {
    // 内置稿纸：setDeskLayout no-op（内置条目原样）
    before.setDeskLayout(custom);
    assert.equal(useSettings.getState().deskPresets[0]?.layout.slots.length, 3, "内置稿纸不可被写");
    // 另存为新版式并激活
    const id = before.saveDeskPreset("夜读", custom);
    assert.ok(id, "另存返回新 id");
    const after = useSettings.getState();
    assert.equal(after.activeDeskPresetId, id);
    assert.equal(after.deskPresets.at(-1)?.name, "夜读");
    // 激活用户版式后可写回
    after.setDeskLayout({ ...custom, headerSlip: true });
    assert.equal(useSettings.getState().deskPresets.at(-1)?.layout.headerSlip, true);
    // 空名拒
    assert.equal(before.saveDeskPreset("   ", custom), null);
    // 删激活版式 → 回稿纸；删内置 no-op
    useSettings.getState().removeDeskPreset(id!);
    const fin = useSettings.getState();
    assert.equal(fin.activeDeskPresetId, "kami-default");
    assert.ok(fin.deskPresets.every((p) => p.id !== id));
    const countBefore = fin.deskPresets.length;
    useSettings.getState().removeDeskPreset("kami-default");
    assert.equal(useSettings.getState().deskPresets.length, countBefore, "内置稿纸删不掉");
  } finally {
    useSettings.setState({
      deskPresets: before.deskPresets,
      activeDeskPresetId: before.activeDeskPresetId,
    });
  }
});

test("shell setters：换形态旋钮脱落、页参数越界回 medium", () => {
  const before = useSettings.getState();
  try {
    useSettings.getState().setShellTweak({ contentWidth: "wide", topbarDensity: "compact" });
    assert.deepEqual(useSettings.getState().shell, { form: "desk", tweaks: { contentWidth: "wide", topbarDensity: "compact" } });
    // desk → rail：topbarDensity 不在 rail 白名单，自动脱落
    useSettings.getState().setShellForm("rail");
    assert.deepEqual(useSettings.getState().shell.tweaks, { contentWidth: "wide" });
    // 越权键直接被 parse 吞掉
    useSettings.getState().setShellTweak({ triggerSide: "right" });
    assert.deepEqual(useSettings.getState().shell.tweaks, { contentWidth: "wide" });
    // 页参数：越界回 medium
    useSettings.getState().setPageLayout({ density: "tight" });
    assert.deepEqual(useSettings.getState().pageLayout, { density: "tight", vaultCol: "medium" });
    useSettings.getState().setPageLayout({ vaultCol: "huge" as unknown as "wide" });
    assert.equal(useSettings.getState().pageLayout.vaultCol, "medium");
  } finally {
    useSettings.setState({ shell: before.shell, pageLayout: before.pageLayout });
  }
});

test("persist v18→v19：themePack 缺省补「未启用+跟随开」，脏值清洗、v18 字段一个不丢", () => {
  const v18 = migrateSettings(
    {
      pixivCookie: PIXIV_SESSION,
      shell: { form: "rail", tweaks: { iconSize: "lg" } },
      pageLayout: { density: "tight", vaultCol: "wide" },
    },
    18,
  ) as Record<string, unknown>;
  assert.deepEqual(v18.themePack, { activeId: null, followShell: true, followLayout: true }, "缺字段补默认");
  assert.deepEqual(v18.shell, { form: "rail", tweaks: { iconSize: "lg" } }, "v18 字段保留");
  assert.deepEqual(v18.pageLayout, { density: "tight", vaultCol: "wide" });
  // v19 新档：指针清洗（空串回 null）、跟随开关缺省 true
  const v19 = migrateSettings(
    { themePack: { activeId: "   ", followShell: false, followLayout: "yes" } },
    19,
  ) as Record<string, unknown>;
  assert.deepEqual(v19.themePack, { activeId: null, followShell: false, followLayout: true });
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
  // v12 老档：只有全局 safeMode=false（R-18 全开）→ 全部站点开（x 同格回安全侧）
  const legacy = migrateSettings({ safeMode: false }, 12) as Record<string, unknown>;
  assert.deepEqual(legacy.safeModeBySite, {
    pixiv: false,
    fanbox: false,
    yande: false,
    konachan: false,
    danbooru: false,
    x: false,
  });
  // v13 新档：记录部分站点 → 缺的站点回安全侧
  const partial = migrateSettings({ safeModeBySite: { pixiv: false } }, 13) as Record<string, unknown>;
  assert.deepEqual(partial.safeModeBySite, {
    pixiv: false,
    fanbox: true,
    yande: true,
    konachan: true,
    danbooru: true,
    x: true,
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
    x: true,
  });
});

test("setSafeModeFor 只动指定站点，其余站点不受牵连", () => {
  const before = useSettings.getState().safeModeBySite;
  try {
    useSettings.setState({ safeModeBySite: { pixiv: true, fanbox: true, yande: true, konachan: true, danbooru: true, x: true } });
    useSettings.getState().setSafeModeFor("pixiv", false);
    assert.deepEqual(useSettings.getState().safeModeBySite, {
      pixiv: false,
      fanbox: true,
      yande: true,
      konachan: true,
      danbooru: true,
      x: true,
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

// ── X 设置段（10-17-x-account-link M4）：persist v15→v16 迁移 + setter + 凭据组装 ──

test("persist v15→v16：X 三段缺省补默认（\"\"/{}/{}），老档已有字段不丢、脏值清洗", () => {
  // v15 老档：整个载荷没有 X 字段（M4 之前的代码从不写它们）
  const v15 = migrateSettings(
    { folderLabel: "Kami", collections: [{ id: "c1", name: "風景", items: [], createdAt: 1, updatedAt: 1 }] },
    15,
  ) as Record<string, unknown>;
  assert.equal(v15.xCookie, "", "缺字段补默认空串，不得是 undefined");
  assert.deepEqual(v15.xAssociations, {}, "缺字段补默认空表");
  assert.deepEqual(v15.xGraphQLQueryIds, {});
  assert.equal(v15.folderLabel, "Kami", "老档已有字段保留");
  assert.equal((v15.collections as Collection[]).length, 1, "v15 已有字段迁移不丢");
  // v15 老档的账号没有 xCookie 字段（运行时 undefined）→ 迁移补 ""
  const withAccounts = migrateSettings(
    { accounts: [{ id: "a1", name: "主号", pixivCookie: PIXIV_SESSION }], activeAccountId: "a1" },
    15,
  ) as { accounts: Account[] };
  assert.equal(withAccounts.accounts[0]?.xCookie, "");
  // v16 新档：已有值经白名单清洗保留（整段 DevTools 头收敛 / 坏关联丢 / 空 queryId 撤覆盖）
  const v16 = migrateSettings(
    {
      xCookie: `guest_id=v1%3A1; ${X_OK}; twid=u%3D2`,
      xAssociations: {
        "pixiv:11": { handle: "@masara", restId: "123", origin: "manual", addedAt: 1 },
        bad: "junk",
      },
      xGraphQLQueryIds: { userMedia: " QWOimofaocjeRda7Tm5pNA ", tweetResult: "" },
    },
    16,
  ) as Record<string, unknown>;
  assert.equal(v16.xCookie, X_OK, "Cookie 收敛成 auth_token+ct0 规范形态");
  assert.deepEqual(v16.xAssociations, {
    "pixiv:11": { handle: "masara", restId: "123", origin: "manual", addedAt: 1 },
  });
  assert.deepEqual(v16.xGraphQLQueryIds, { userMedia: "QWOimofaocjeRda7Tm5pNA" }, "空串=未覆盖被撤");
  // 空档兜底
  const empty = migrateSettings(null, 0) as Record<string, unknown>;
  assert.deepEqual(empty.xAssociations, {});
  assert.deepEqual(empty.xGraphQLQueryIds, {});
  assert.equal(empty.xCookie, "");
});

test("setXCookie：写当前账号（无账号自动建号），syncSessions 镜像带清洗后的 x", async () => {
  const fetchOriginal = globalThis.fetch;
  // 经对象属性绕开 TS 的「闭包外仍视为 null」收窄；saveSessions 的 body 是扁平
  // { pixiv, fanbox, x, … }（sessionSchema 同形），没有 data 包裹层
  const captured: { posted: { x?: string } | null } = { posted: null };
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.posted = init?.body ? (JSON.parse(String(init.body)) as { x?: string }) : null;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  resetStore();
  resetXState();
  try {
    useSettings.getState().setXCookie(`noise; ${X_OK}; extra=1`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const s = useSettings.getState();
    assert.equal(s.accounts.length, 1, "无账号时自动建号");
    assert.equal(s.accounts[0]?.xCookie, `noise; ${X_OK}; extra=1`, "账号存原文（清洗在边界）");
    assert.equal(s.activeAccountId, s.accounts[0]?.id);
    assert.equal(s.xCookie, `noise; ${X_OK}; extra=1`, "顶层镜像当前账号");
    assert.equal(captured.posted?.x, X_OK, "服务端镜像只收 sanitize 后的规范形态");
    // 半截 Cookie（只 auth_token）：存原文可继续编辑，镜像侧不落
    useSettings.getState().setXCookie(`auth_token=${X_TOKEN}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(captured.posted?.x, "", "缺 ct0 不落镜像");
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    resetXState();
  }
});

test("setXAssociation / removeXAssociation：清洗入库、坏值拒、解除删键", () => {
  const before = useSettings.getState().xAssociations;
  try {
    useSettings.setState({ xAssociations: {} });
    useSettings.getState().setXAssociation("pixiv:11", {
      handle: "@masara",
      restId: "123",
      origin: "manual",
      addedAt: 1,
    });
    assert.deepEqual(useSettings.getState().xAssociations, {
      "pixiv:11": { handle: "masara", restId: "123", origin: "manual", addedAt: 1 },
    }, "@ 前缀剥掉、restId 保留");
    // 坏 handle 整条拒：表不动
    const snap = useSettings.getState().xAssociations;
    useSettings.getState().setXAssociation("pixiv:12", { handle: "bad handle", origin: "auto", addedAt: 1 });
    assert.deepEqual(useSettings.getState().xAssociations, snap);
    // 空键拒
    useSettings.getState().setXAssociation("   ", { handle: "ok", origin: "auto", addedAt: 1 });
    assert.deepEqual(useSettings.getState().xAssociations, snap);
    // 解除关联：删键；未命中 no-op
    useSettings.getState().removeXAssociation("pixiv:11");
    assert.deepEqual(useSettings.getState().xAssociations, {});
    useSettings.getState().removeXAssociation("不存在的");
    assert.deepEqual(useSettings.getState().xAssociations, {});
  } finally {
    useSettings.setState({ xAssociations: before });
  }
});

test("cookiesFromSettings：X 凭据只在 x 数据源请求里带，Cookie 走 sanitize、空覆盖不进键", () => {
  const before = useSettings.getState();
  try {
    useSettings.setState({
      xCookie: `junk; ${X_OK}; extra=1`,
      xGraphQLQueryIds: { userByScreenName: "NewId_1", userMedia: "" },
    } as Partial<typeof before>);
    const x = cookiesFromSettings("x");
    assert.equal(x.xCookie, X_OK, "请求只带 sanitize 后的两字段形态");
    assert.deepEqual(x.xQueryIds, { userByScreenName: "NewId_1" }, "空覆盖撤掉、好覆盖带上");
    assert.equal(x.safeMode, before.safeModeBySite.x, "safeMode 取 x 自己的开关");
    const pixiv = cookiesFromSettings("pixiv");
    assert.equal(pixiv.xCookie, undefined, "其他数据源不带 X Cookie");
    assert.equal(pixiv.xQueryIds, undefined);
  } finally {
    useSettings.setState({ xCookie: before.xCookie, xGraphQLQueryIds: before.xGraphQLQueryIds });
  }
});

test("partialize 白名单键清单与实际输出一致，X 三段在册（结构性漏采回归锁）", () => {
  const keys = Object.keys(partializeSettings(useSettings.getState())).sort();
  assert.deepEqual(keys, [...SETTINGS_PERSIST_FIELDS].sort(), "手抄清单与 partialize 输出不得漂移");
  for (const field of ["xCookie", "xAssociations", "xGraphQLQueryIds"]) {
    assert.ok(SETTINGS_PERSIST_FIELDS.includes(field), `${field} 必须持久化`);
  }
});

test("persist v19→v20：shell.custom 缺省无感；setShellCustom 深合并钳制并切到 custom 形态", () => {
  const before = useSettings.getState();
  try {
    const v19 = migrateSettings({ shell: { form: "rail", tweaks: { iconSize: "lg" } } }, 19) as {
      shell?: { form?: string; tweaks?: Record<string, string>; custom?: unknown };
    };
    assert.equal(v19.shell?.form, "rail", "预设档零感知");
    assert.deepEqual(v19.shell?.tweaks, { iconSize: "lg" });
    assert.equal(v19.shell?.custom, undefined, "预设档不带 custom 键");
    // 深合并 + 钳制：icons 999 → 88；未给的段用默认
    useSettings.getState().setShellCustom({ sidebar: { mode: "icons", side: "left", width: 999 } });
    const after = useSettings.getState().shell;
    assert.equal(after.form, "custom");
    assert.deepEqual(after.tweaks, {});
    assert.equal(after.custom?.sidebar.width, 88);
    assert.deepEqual(after.custom?.topbar, { visible: true, density: "normal" });
    // 二次 patch 只动给定字段
    useSettings.getState().setShellCustom({ topbar: { visible: false, density: "compact" } });
    const fin = useSettings.getState().shell.custom;
    assert.equal(fin?.sidebar.mode, "icons", "前次 custom 保留");
    assert.deepEqual(fin?.topbar, { visible: false, density: "compact" });
    // 切走再切回 custom：参数保留（setShellForm 透传 custom）
    useSettings.getState().setShellForm("rail");
    assert.equal(useSettings.getState().shell.form, "rail");
    useSettings.getState().setShellForm("custom");
    const back = useSettings.getState().shell;
    assert.equal(back.form, "custom");
    assert.equal(back.custom?.sidebar.mode, "icons", "切回 custom 保留此前参数");
    assert.equal(back.custom?.topbar.visible, false);
    // v20 老档带 custom 原样过洗（越界仍钳）
    const v20 = migrateSettings({ shell: { form: "custom", custom: { sidebar: { mode: "full", width: 100 } } } }, 20) as { shell: { custom?: { sidebar: { width: number } } } };
    assert.equal(v20.shell.custom?.sidebar.width, 200, "full 100 钳到下限");
  } finally {
    useSettings.setState({ shell: before.shell });
  }
});

test("persist v20→v21：内置「编辑式」注入为第二版式，v20 字段一个不丢、激活指针不动", () => {
  const v20 = migrateSettings(
    {
      pixivCookie: PIXIV_SESSION,
      deskPresets: [{ id: "p1", name: "夜读", layout: { slots: [{ span: 2, items: ["browse-sheet"] }] } }],
      activeDeskPresetId: "p1",
      shell: { form: "rail", tweaks: { iconSize: "lg" } },
    },
    20,
  ) as Record<string, unknown>;
  const desk = v20.deskPresets as { id: string; builtIn?: boolean; layout: { headerSeal?: boolean } }[];
  assert.equal(desk.length, 3, "稿纸+编辑式+夜读");
  assert.equal(desk[1]?.id, "kami-editorial", "编辑式恒为内置第二");
  assert.ok(desk[1]?.builtIn);
  assert.equal(desk[1]?.layout.headerSeal, true, "编辑式带印章头");
  assert.equal(desk[2]?.id, "p1", "用户版式跟在两条内置后");
  assert.equal(v20.activeDeskPresetId, "p1", "激活指针不动（不因注入换版式）");
  assert.deepEqual(v20.shell, { form: "rail", tweaks: { iconSize: "lg" } }, "v20 字段保留");
  // 用户档手写 headerSeal 脏值不透传（parseDeskLayout 只认 true）
  const dirty = migrateSettings({ deskPresets: [{ id: "d1", name: "脏", layout: { slots: [{ span: 1, items: ["letters"] }], headerSeal: "yes" } }] }, 21) as {
    deskPresets: { layout: { headerSeal?: unknown } }[];
  };
  assert.notEqual(dirty.deskPresets.at(-1)?.layout.headerSeal, true, "脏值不视为编辑式头");
});

test("全新安装初始档即含双内置（新装不走 migrate，手抄初始曾漏编辑式）", () => {
  const fresh = useSettings.getState().deskPresets as { id: string; builtIn?: boolean }[];
  const ids = fresh.map((p) => p.id);
  assert.equal(ids[0], "kami-default", "初始第一条恒为内置稿纸");
  assert.ok(fresh[0]?.builtIn);
  assert.ok(ids.includes("kami-editorial"), "新装用户也能在版式架见到编辑式");
  assert.equal(useSettings.getState().activeDeskPresetId, "kami-default", "新装默认仍是稿纸");
});

test("微调即接管（健壮二批 R4）：跟随主题时改本地外壳/版式自动关跟随", () => {
  const before = useSettings.getState();
  const custom = { slots: [{ span: 3 as const, items: ["newspaper" as const] }], headerSlip: false };
  try {
    useSettings.setState({ themePack: { activeId: "yehang", followShell: true, followLayout: true } });
    // 外壳：setShellForm / setShellTweak 关 followShell（不动 followLayout）
    useSettings.getState().setShellForm("rail");
    assert.equal(useSettings.getState().themePack.followShell, false, "改形态自动停跟随外壳");
    assert.equal(useSettings.getState().themePack.followLayout, true, "布局跟随不受牵连");
    assert.equal(useSettings.getState().shell.form, "rail", "本地外壳照常写入");
    useSettings.getState().setThemePackFollow({ followShell: true });
    useSettings.getState().setShellTweak({ iconSize: "lg" });
    assert.equal(useSettings.getState().themePack.followShell, false, "改旋钮自动停跟随外壳");
    // 版式：activateDeskPreset / saveDeskPreset / setDeskLayout 关 followLayout
    useSettings.getState().setThemePackFollow({ followShell: true, followLayout: true });
    const id = useSettings.getState().saveDeskPreset("接管测试", custom);
    assert.ok(id);
    assert.equal(useSettings.getState().themePack.followLayout, false, "存版式自动停跟随布局");
    useSettings.getState().setThemePackFollow({ followLayout: true });
    useSettings.getState().activateDeskPreset("kami-default");
    assert.equal(useSettings.getState().themePack.followLayout, false, "切版式自动停跟随布局");
    // 无激活包 / 跟随已关：行为不变（不误置）
    useSettings.setState({ themePack: { activeId: null, followShell: true, followLayout: true } });
    useSettings.getState().setShellTweak({ topbarDensity: "compact" });
    assert.equal(useSettings.getState().themePack.followShell, true, "无激活包时跟随开关不动");
  } finally {
    useSettings.setState({
      themePack: before.themePack,
      shell: before.shell,
      deskPresets: before.deskPresets,
      activeDeskPresetId: before.activeDeskPresetId,
    });
  }
});
