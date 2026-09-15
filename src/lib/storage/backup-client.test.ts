/**
 * 同步段结构性列表回归（smartFolders / watchArtists / 白名单）。
 *
 * 作用：锁「采集白名单必须带上智能文件夹与追踪列表」与「拉取旧载荷（字段缺失）
 *       不得清空本地列表、显式空列表照常应用」两条线。
 * 用法：node:test 直跑；fetch 打桩成 200 空 JSON（applySegment 会触发 syncSessions）。
 * 为什么：这两类列表曾长期漏在 snapshotSettings 白名单外——推不进同步段，
 *        拉取侧 parse 的空默认值还会把本地整份抹掉（升级窗口数据丢失面）。
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
  };
  return fn().finally(() => {
    useSettings.setState({ smartFolders: before.smartFolders, watchArtists: before.watchArtists });
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
