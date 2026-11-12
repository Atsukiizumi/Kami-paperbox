import assert from "node:assert/strict";
import { test } from "node:test";
import { vaultPageHeaders } from "./vault-page-mime.ts";

test("纸匣页 MIME 白名单：媒体内联 + nosniff，白名单外按附件（卫生批②）", () => {
  const jpg = vaultPageHeaders("jpg");
  assert.equal(jpg["content-type"], "image/jpeg");
  assert.equal(jpg["x-content-type-options"], "nosniff");
  assert.equal(jpg["content-disposition"], undefined, "白名单媒体保持内联");

  const zip = vaultPageHeaders("ZIP");
  assert.equal(zip["content-type"], "application/zip", "ugoira 包按 zip 下发");

  // html / svg：客户端可自行入库的扩展名——必须不可渲染
  for (const ext of ["html", "svg", "htm"]) {
    const bad = vaultPageHeaders(ext);
    assert.equal(bad["content-type"], "application/octet-stream", `${ext} 不给文档 MIME`);
    assert.equal(bad["content-disposition"], "attachment", `${ext} 强制附件下载`);
    assert.equal(bad["x-content-type-options"], "nosniff");
  }
});
