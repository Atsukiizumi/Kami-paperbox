/**
 * 导出分拣：hasFile 没标上、但文件夹路径还在的藏品要进 ZIP，不能被当成没图丢掉。
 */
import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";
import { test } from "node:test";
import type { VaultMeta } from "../types.ts";
import { folderExportTargets, partitionVaultExport, zipWithFolderFiles } from "./vault-export-plan.ts";

function meta(over: Partial<VaultMeta> & Pick<VaultMeta, "key">): VaultMeta {
  const cut = over.key.indexOf(":");
  return {
    source: over.key.slice(0, cut) as VaultMeta["source"],
    id: over.key.slice(cut + 1),
    title: "t",
    author: "a",
    authorId: "1",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 1,
    ...over,
  };
}

test("partitionVaultExport：文件夹里的原图单独分出来，应用内有图的仍走服务端", () => {
  const plan = partitionVaultExport([
    meta({ key: "pixiv:1", relativePath: "a/1.png" }),
    meta({ key: "pixiv:2", hasFile: true, relativePath: "a/2.png" }),
    meta({ key: "pixiv:3", hasFile: false, relativePath: "a/3.png" }),
    meta({ key: "pixiv:4" }),
  ]);
  assert.deepEqual(plan.server.map((item) => item.key), ["pixiv:2"], "有服务端原图的不重复从文件夹再打一份");
  assert.deepEqual(plan.folder.map((item) => item.key), ["pixiv:1", "pixiv:3"], "hasFile 缺省或 false、路径还在的进文件夹");
  assert.equal(plan.truncated, false);
});

test("partitionVaultExport：超过上限只留前面的，并标 truncated", () => {
  const items = ["pixiv:1", "pixiv:2", "pixiv:3"].map((key) => meta({ key, hasFile: true }));
  const plan = partitionVaultExport(items, 2);
  assert.deepEqual(plan.server.map((item) => item.key), ["pixiv:1", "pixiv:2"]);
  assert.equal(plan.truncated, true);
});

test("folderExportTargets：第 0 页用记下的路径，后面的页用推出来的路径", () => {
  assert.deepEqual(
    folderExportTargets({ relativePath: "A/1_p0.png", pageCount: 3 }, (page) => `A/1_p${page}.png`),
    [
      { page: 0, path: "A/1_p0.png" },
      { page: 1, path: "A/1_p1.png" },
      { page: 2, path: "A/1_p2.png" },
    ],
  );
  assert.deepEqual(
    folderExportTargets({ relativePath: "only.png", pageCount: 2 }, () => "only.png"),
    [{ page: 0, path: "only.png" }],
    "推出来的路径和记下的相同就不再读一遍",
  );
  assert.deepEqual(folderExportTargets({ pageCount: 2 }, () => "x"), []);
});

test("zipWithFolderFiles：文件夹原图补进服务端包，同名留服务端那份", () => {
  const server = zipSync({ "a/p0.jpg": strToU8("server"), "_skipped.json": strToU8("[]") });
  const merged = unzipSync(zipWithFolderFiles(server, { "b/p0.png": strToU8("folder"), "a/p0.jpg": strToU8("nope") }));
  assert.equal(new TextDecoder().decode(merged["a/p0.jpg"]), "server");
  assert.equal(new TextDecoder().decode(merged["b/p0.png"]), "folder");
  assert.equal(new TextDecoder().decode(merged["_skipped.json"]), "[]");
  const only = unzipSync(zipWithFolderFiles(null, { "b/p0.png": strToU8("folder") }));
  assert.equal(new TextDecoder().decode(only["b/p0.png"]), "folder");
});
