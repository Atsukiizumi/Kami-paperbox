/**
 * 同步段结构性列表回归（smartFolders / watchArtists / tagAliases / 白名单）。
 *
 * 作用：锁「采集白名单必须带上智能文件夹、追踪列表与标签别名」与「拉取旧
 *       载荷（字段缺失）不得清空本地列表、显式空列表照常应用」两条线。
 * 用法：node:test 直跑；fetch 打桩成 200 空 JSON（applySegment 会触发 syncSessions）。
 * 为什么：这两类列表曾长期漏在 snapshotSettings 白名单外——推不进同步段，
 *        拉取侧 parse 的空默认值还会把本地整份抹掉（升级窗口数据丢失面）。
 *        tagAliases（标签整理）走同一陷阱位，#151 白名单实证。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applySegment, SNAPSHOT_SETTINGS_FIELDS, snapshotSettings } from "./backup-client.ts";
import { BACKUP_SETTINGS_FIELDS } from "./backup.ts";
import { SETTINGS_PERSIST_FIELDS, useSettings } from "../store.ts";
import type { Collection } from "../collection.ts";
import type { SmartFolder } from "./vault-query.ts";

const FOLDER_A: SmartFolder = {
  id: "f1",
  name: "心头好",
  query: { text: "", source: "pixiv", author: "あいす", tags: [], month: undefined },
};

const TAG_ALIASES_A = { 鳴潮: "鸣潮", Waves: "鸣潮" };

function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function withLocalLists<T>(fn: () => Promise<T>): Promise<T> {
  const before = {
    smartFolders: useSettings.getState().smartFolders,
    watchArtists: useSettings.getState().watchArtists,
    tagAliases: useSettings.getState().tagAliases,
    authorAliases: useSettings.getState().authorAliases,
    collections: useSettings.getState().collections,
    xCookie: useSettings.getState().xCookie,
    xAssociations: useSettings.getState().xAssociations,
    xGraphQLQueryIds: useSettings.getState().xGraphQLQueryIds,
    accounts: useSettings.getState().accounts,
    activeAccountId: useSettings.getState().activeAccountId,
  };
  return fn().finally(() => {
    useSettings.setState({
      smartFolders: before.smartFolders,
      watchArtists: before.watchArtists,
      tagAliases: before.tagAliases,
      authorAliases: before.authorAliases,
      collections: before.collections,
      xCookie: before.xCookie,
      xAssociations: before.xAssociations,
      xGraphQLQueryIds: before.xGraphQLQueryIds,
      accounts: before.accounts,
      activeAccountId: before.activeAccountId,
    });
  });
}

test("采集白名单带上智能文件夹与追踪列表（不再漏采）", () => {
  useSettings.setState({ smartFolders: [FOLDER_A], watchArtists: [], watchLimit: 100 });
  const snap = snapshotSettings();
  assert.equal(snap.smartFolders.length, 1, "smartFolders 必须进设置段");
  assert.equal(snap.watchLimit, 100, "watchLimit 必须进设置段");
});

test("拉取旧载荷（无 smartFolders 键）不清空本地智能文件夹", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ smartFolders: [FOLDER_A] });
      // 旧版本推送的载荷：整个 settings 里没有 smartFolders 字段
      await applySegment("settings", { settings: { hideAi: true } });
      assert.equal(useSettings.getState().smartFolders.length, 1, "字段缺失时应保留本地");
    });
  } finally {
    restore();
  }
});

test("拉取显式空列表（用户真清空）照常应用", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ smartFolders: [FOLDER_A] });
      await applySegment("settings", { settings: { hideAi: true, smartFolders: [] } });
      assert.equal(useSettings.getState().smartFolders.length, 0, "显式空列表应清空本地");
    });
  } finally {
    restore();
  }
});

test("采集白名单带上标签别名（标签整理不漏采）", () => {
  const before = useSettings.getState().tagAliases;
  try {
    useSettings.setState({ tagAliases: TAG_ALIASES_A });
    const snap = snapshotSettings();
    assert.deepEqual(snap.tagAliases, TAG_ALIASES_A, "tagAliases 必须进设置段");
  } finally {
    useSettings.setState({ tagAliases: before });
  }
});

test("拉取旧载荷（无 tagAliases 键）不清空本地标签别名", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ tagAliases: TAG_ALIASES_A });
      // 旧版本推送的载荷：整个 settings 里没有 tagAliases 字段
      await applySegment("settings", { settings: { hideAi: true } });
      assert.deepEqual(useSettings.getState().tagAliases, TAG_ALIASES_A, "字段缺失时应保留本地");
    });
  } finally {
    restore();
  }
});

test("拉取显式空标签别名（用户真清空）照常应用", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ tagAliases: TAG_ALIASES_A });
      await applySegment("settings", { settings: { hideAi: true, tagAliases: {} } });
      assert.deepEqual(useSettings.getState().tagAliases, {}, "显式空表应清空本地");
    });
  } finally {
    restore();
  }
});

const AUTHOR_ALIASES_A = { "然天 ran_tian": "然天" };

test("采集白名单带上画师别名（authorAliases 不漏采）", () => {
  const before = useSettings.getState().authorAliases;
  try {
    useSettings.setState({ authorAliases: AUTHOR_ALIASES_A });
    const snap = snapshotSettings();
    assert.deepEqual(snap.authorAliases, AUTHOR_ALIASES_A, "authorAliases 必须进设置段");
  } finally {
    useSettings.setState({ authorAliases: before });
  }
});

test("拉取旧载荷（无 authorAliases 键）不清空本地画师别名", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ authorAliases: AUTHOR_ALIASES_A });
      // 旧版本推送的载荷：整个 settings 里没有 authorAliases 字段（#151 遗留坑，2026-09-17 修复）
      await applySegment("settings", { settings: { hideAi: true } });
      assert.deepEqual(useSettings.getState().authorAliases, AUTHOR_ALIASES_A, "字段缺失时应保留本地");
    });
  } finally {
    restore();
  }
});

test("拉取显式空画师别名（用户真清空）照常应用", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ authorAliases: AUTHOR_ALIASES_A });
      await applySegment("settings", { settings: { hideAi: true, authorAliases: {} } });
      assert.deepEqual(useSettings.getState().authorAliases, {}, "显式空表应清空本地");
    });
  } finally {
    restore();
  }
});

// ── 标签订阅（09-21-tag-watch-vault-filter）：结构性列表同款白名单/守卫 ──────

const WATCH_TAGS_A = [{ source: "pixiv" as const, tag: "鳴潮", addedAt: 1, lastSeenId: "900" }];

test("采集白名单带上标签订阅（watchTags 不漏采）", () => {
  const before = useSettings.getState().watchTags;
  try {
    useSettings.setState({ watchTags: WATCH_TAGS_A });
    const snap = snapshotSettings();
    assert.deepEqual(snap.watchTags, WATCH_TAGS_A, "watchTags 必须进设置段");
  } finally {
    useSettings.setState({ watchTags: before });
  }
});

test("拉取旧载荷（无 watchTags 键）不清空本地标签订阅", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ watchTags: WATCH_TAGS_A });
      await applySegment("settings", { settings: { hideAi: true } });
      assert.equal(useSettings.getState().watchTags.length, 1, "字段缺失时应保留本地");
    });
  } finally {
    restore();
  }
});

test("拉取显式空标签订阅（用户真清空）照常应用", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ watchTags: WATCH_TAGS_A });
      await applySegment("settings", { settings: { hideAi: true, watchTags: [] } });
      assert.equal(useSettings.getState().watchTags.length, 0, "显式空列表应清空本地");
    });
  } finally {
    restore();
  }
});

// ── 手工合集（09-27-collections）：结构性列表同款白名单/守卫 ─────────────────

const COLLECTION_A: Collection = { id: "c1", name: "風景", items: ["pixiv:1", "yande:2"], createdAt: 1, updatedAt: 2 };

test("采集白名单带上手工合集（collections 不漏采）", () => {
  const before = useSettings.getState().collections;
  try {
    useSettings.setState({ collections: [COLLECTION_A] });
    const snap = snapshotSettings();
    assert.deepEqual(snap.collections, [COLLECTION_A], "collections 必须进设置段");
  } finally {
    useSettings.setState({ collections: before });
  }
});

test("拉取旧载荷（无 collections 键）不清空本地合集", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ collections: [COLLECTION_A] });
      // 旧版本推送的载荷：整个 settings 里没有 collections 字段（#151 同款另一半事故）
      await applySegment("settings", { settings: { hideAi: true } });
      assert.deepEqual(useSettings.getState().collections, [COLLECTION_A], "字段缺失时应保留本地");
    });
  } finally {
    restore();
  }
});

test("拉取显式空合集（用户真清空）照常应用", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({ collections: [COLLECTION_A] });
      await applySegment("settings", { settings: { hideAi: true, collections: [] } });
      assert.equal(useSettings.getState().collections.length, 0, "显式空列表应清空本地");
    });
  } finally {
    restore();
  }
});

// ── X 设置段（10-17-x-account-link M4）：结构性列表同款白名单/守卫 + 三处交叉断言 ──

const X_TOKEN = "a".repeat(40);
const X_CT0 = "b".repeat(40);
const X_OK = `auth_token=${X_TOKEN}; ct0=${X_CT0}`;
const X_ASSOCS_A = { "pixiv:11": { handle: "masara", origin: "manual" as const, addedAt: 1 } };
const X_QUERY_IDS_A = { userMedia: "OverrideId_1" };

test("采集白名单带上 X 三段（xCookie/xAssociations/xGraphQLQueryIds 不漏采）", () => {
  const before = {
    xCookie: useSettings.getState().xCookie,
    xAssociations: useSettings.getState().xAssociations,
    xGraphQLQueryIds: useSettings.getState().xGraphQLQueryIds,
  };
  try {
    useSettings.setState({ xCookie: X_OK, xAssociations: X_ASSOCS_A, xGraphQLQueryIds: X_QUERY_IDS_A });
    const snap = snapshotSettings();
    assert.equal(snap.xCookie, X_OK, "xCookie 必须进设置段");
    assert.deepEqual(snap.xAssociations, X_ASSOCS_A, "xAssociations 必须进设置段");
    assert.deepEqual(snap.xGraphQLQueryIds, X_QUERY_IDS_A, "xGraphQLQueryIds 必须进设置段");
  } finally {
    useSettings.setState(before);
  }
});

test("拉取旧载荷（无 X 字段键）不清空本地 X 段与账号级 X Cookie", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({
        xCookie: X_OK,
        xAssociations: X_ASSOCS_A,
        xGraphQLQueryIds: X_QUERY_IDS_A,
        accounts: [
          { id: "acc-1", name: "主号", pixivCookie: "", fanboxCookie: "", xCookie: X_OK },
        ],
        activeAccountId: "acc-1",
      });
      // 旧版本推送的载荷：整个 settings 里没有任何 X 字段（含账号记录不带 xCookie 键）
      await applySegment("settings", {
        settings: { hideAi: true, accounts: [{ id: "acc-1", name: "主号" }] },
      });
      assert.deepEqual(useSettings.getState().xAssociations, X_ASSOCS_A, "字段缺失时应保留本地关联表");
      assert.deepEqual(useSettings.getState().xGraphQLQueryIds, X_QUERY_IDS_A, "字段缺失时保留本地覆盖");
      assert.equal(useSettings.getState().xCookie, X_OK, "字段缺失时保留本地顶层 xCookie");
      assert.equal(useSettings.getState().accounts[0]?.xCookie, X_OK, "账号级 X Cookie 按 id 并回（升级窗口守卫）");
    });
  } finally {
    restore();
  }
});

test("拉取显式空 X 段（用户真清空）照常应用", async () => {
  const restore = stubFetch();
  try {
    await withLocalLists(async () => {
      useSettings.setState({
        xCookie: X_OK,
        xAssociations: X_ASSOCS_A,
        xGraphQLQueryIds: X_QUERY_IDS_A,
        accounts: [
          { id: "acc-1", name: "主号", pixivCookie: "", fanboxCookie: "", xCookie: X_OK },
        ],
        activeAccountId: "acc-1",
      });
      await applySegment("settings", {
        settings: {
          hideAi: true,
          xCookie: "",
          xAssociations: {},
          xGraphQLQueryIds: {},
          accounts: [{ id: "acc-1", name: "主号", xCookie: "" }],
        },
      });
      assert.deepEqual(useSettings.getState().xAssociations, {}, "显式空表应清空本地");
      assert.deepEqual(useSettings.getState().xGraphQLQueryIds, {});
      assert.equal(useSettings.getState().xCookie, "");
      assert.equal(useSettings.getState().accounts[0]?.xCookie, "", "远端账号带显式空 xCookie = 用户真清了，照用远端");
    });
  } finally {
    restore();
  }
});

test("三处字段清单交叉断言：X 三段在册，采集清单 ⊆ persist ∩ 备份（三处接线回归锁）", () => {
  for (const field of ["xCookie", "xAssociations", "xGraphQLQueryIds"] as const) {
    assert.ok(SETTINGS_PERSIST_FIELDS.includes(field), `store persist 白名单缺 ${field}`);
    assert.ok(BACKUP_SETTINGS_FIELDS.includes(field), `备份字段清单缺 ${field}`);
    assert.ok(SNAPSHOT_SETTINGS_FIELDS.includes(field), `采集白名单缺 ${field}`);
  }
  // 更强的结构性防线：每个被采集的设置段字段必须既被持久化（重启不丢）也被
  // 备份解析认得（拉取侧 parse 不会用默认值清空）——漏任何一处就是同步事故
  for (const field of SNAPSHOT_SETTINGS_FIELDS) {
    assert.ok(SETTINGS_PERSIST_FIELDS.includes(field), `采集了 ${field} 但 persist 白名单没有（重启即丢）`);
    assert.ok(BACKUP_SETTINGS_FIELDS.includes(field), `采集了 ${field} 但备份解析不认（拉取会清空）`);
  }
});
