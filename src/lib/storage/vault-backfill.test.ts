/**
 * 档案补全纯逻辑（J）：清单过滤 / 补丁口径 / 幂等断点 / 取消 / 失败跳过。
 * 桩注入（loadImpl/patchImpl/listImpl），不碰 IDB 与网络。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { backfillPatch, backfillTargets, needsBackfill, runVaultBackfill } from "./vault-backfill.ts";
import type { VaultMeta, WorkDetail } from "../types.ts";

function item(over: Partial<VaultMeta> & Pick<VaultMeta, "key" | "source" | "id">): VaultMeta {
  return {
    title: "t",
    author: "a",
    authorId: "",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 1,
    ...over,
  } as VaultMeta;
}

const UNKNOWN = item({ key: "pixiv:1", source: "pixiv", id: "1" });
const FILLED = item({ key: "pixiv:2", source: "pixiv", id: "2", aiType: 0, xRestrict: 0, rating: "" });
const ONLY_RATING = item({ key: "yande:3", source: "yande", id: "3", rating: "s" });

test("needsBackfill：三字段全 undefined 才算未知；任一显式值（含 0/''）即已补", () => {
  assert.equal(needsBackfill(UNKNOWN), true);
  assert.equal(needsBackfill(FILLED), false);
  assert.equal(needsBackfill(ONLY_RATING), false);
  assert.deepEqual(backfillTargets([UNKNOWN, FILLED, ONLY_RATING]).map((x) => x.key), ["pixiv:1"]);
});

test("backfillPatch：显式落值区分「确认没有」；空标签顺带补", () => {
  const detail = { source: "pixiv", id: "1", aiType: 0, xRestrict: 2, rating: "", tags: ["R-18G", "猫"] } as unknown as WorkDetail;
  const patch = backfillPatch(UNKNOWN, detail);
  assert.equal(patch.aiType, 0, "非 AI 显式 0（≠unknown）");
  assert.equal(patch.xRestrict, 2);
  assert.equal(patch.rating, "");
  assert.deepEqual(patch.tags, ["R-18G", "猫"], "空标签补上");
  // 已有标签不动
  const keep = backfillPatch({ ...UNKNOWN, tags: ["既存"] }, detail);
  assert.equal(keep.tags, undefined);
});

test("runVaultBackfill：逐条回填、失败跳过、进度取消（幂等断点 = 重跑只碰仍缺）", async () => {
  const patched: string[] = [];
  const loads: string[] = [];
  const UNKNOWN2 = item({ key: "pixiv:4", source: "pixiv", id: "4" });
  const raw = [UNKNOWN, UNKNOWN2, ONLY_RATING, FILLED]; // 后两条会被清单过滤跳过
  let cancelAt = -1;
  const r = await runVaultBackfill({
    listImpl: async () => raw,
    loadImpl: async (source, id) => {
      loads.push(`${source}:${id}`);
      return { source, id, aiType: 1, xRestrict: 0, rating: "", tags: ["补"] } as unknown as WorkDetail;
    },
    patchImpl: async (key, patch) => {
      patched.push(`${key}:${JSON.stringify(patch)}`);
    },
    delayMs: 0,
    onProgress: (p) => {
      if (p.done >= 1 && cancelAt < 0) {
        cancelAt = p.done;
        return false; // 处理完第一条后取消
      }
    },
  });
  assert.deepEqual(loads, ["pixiv:1"], "清单过滤生效 + 取消后不再打上游");
  assert.equal(r.ok, 1);
  assert.equal(r.failed, 0);
  assert.equal(r.remaining, 1, "取消时剩 1 条待补");
  assert.ok(patched[0]?.startsWith("pixiv:1:"));

  // 重跑（不取消）：第一条已补（模拟 patch 生效），只剩第二条
  const r2 = await runVaultBackfill({
    listImpl: async () => [item({ key: "pixiv:1", source: "pixiv", id: "1", aiType: 1 }), UNKNOWN2, FILLED],
    loadImpl: async (source, id) => {
      assert.equal(id, "4", "重跑只碰仍缺的条目");
      return { source, id, aiType: 0, xRestrict: 0, rating: "", tags: [] } as unknown as WorkDetail;
    },
    patchImpl: async () => undefined,
    delayMs: 0,
  });
  assert.equal(r2.ok, 1);
  assert.equal(r2.failed, 0);
  assert.equal(r2.remaining, 0);
  // 全失败路径不炸
  const r3 = await runVaultBackfill({
    listImpl: async () => [UNKNOWN],
    loadImpl: async () => {
      throw new Error("boom");
    },
    patchImpl: async () => undefined,
    delayMs: 0,
  });
  assert.deepEqual([r3.ok, r3.failed, r3.remaining], [0, 1, 0]);
});
