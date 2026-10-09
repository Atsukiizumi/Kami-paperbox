import assert from "node:assert/strict";
import { test } from "node:test";
import { folderWriteEnabled } from "./persist-files.ts";

const bothOn = { downloadToFolder: true, vaultMirrorFolder: true };
const bothOff = { downloadToFolder: false, vaultMirrorFolder: false };
const downloadOnly = { downloadToFolder: true, vaultMirrorFolder: false };
const mirrorOnly = { downloadToFolder: false, vaultMirrorFolder: true };

test("收入纸匣只看镜像开关", () => {
  assert.equal(folderWriteEnabled(false, bothOn), true);
  assert.equal(folderWriteEnabled(false, mirrorOnly), true);
  assert.equal(folderWriteEnabled(false, downloadOnly), false);
  assert.equal(folderWriteEnabled(false, bothOff), false);
});

test("下载只看下载开关", () => {
  assert.equal(folderWriteEnabled(true, bothOn), true);
  assert.equal(folderWriteEnabled(true, downloadOnly), true);
  assert.equal(folderWriteEnabled(true, mirrorOnly), false);
  assert.equal(folderWriteEnabled(true, bothOff), false);
});
