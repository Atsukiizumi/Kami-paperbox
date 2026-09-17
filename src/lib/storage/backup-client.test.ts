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
import { applySegment, snapshotSettings } from "./backup-client.ts";
import { useSettings } from "../store.ts";
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
  };
  return fn().finally(() => {
    useSettings.setState({
      smartFolders: before.smartFolders,
      watchArtists: before.watchArtists,
      tagAliases: before.tagAliases,
      authorAliases: before.authorAliases,
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
