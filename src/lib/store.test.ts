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
