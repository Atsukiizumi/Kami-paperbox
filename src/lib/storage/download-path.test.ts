import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PATH_TEMPLATE,
  flattenDownloadName,
  formatDownloadPath,
  parsePathPreset,
  SAMPLE_PATH_CONTEXT,
  templateForPreset,
} from "./download-path.ts";

const ctx = SAMPLE_PATH_CONTEXT;

test("formatDownloadPath fills author folders", () => {
  assert.equal(formatDownloadPath(DEFAULT_PATH_TEMPLATE, ctx), "こいし/12345_p0_无题.jpg");
});

test("formatDownloadPath fills date and time tokens", () => {
  assert.equal(
    formatDownloadPath("{date}/{time}_{id}_p{page}_{title}.{ext}", ctx),
    "2026-08-31/160500_12345_p0_无题.jpg",
  );
  assert.equal(
    formatDownloadPath("{author}/{year}-{month}/{id}_p{page}.{ext}", ctx),
    "こいし/2026-08/12345_p0.jpg",
  );
});

test("formatDownloadPath strips traversal and empty segments", () => {
  assert.equal(formatDownloadPath("{author}/../{id}.{ext}", ctx), "こいし/12345.jpg");
  assert.equal(formatDownloadPath("a\\\\b/{id}.{ext}", ctx), "a/b/12345.jpg");
  assert.equal(formatDownloadPath("../{id}.{ext}", ctx), "12345.jpg");
});

test("formatDownloadPath sanitizes illegal names", () => {
  const nasty = {
    ...ctx,
    author: "a/b:c*",
    title: 'ok?"',
  };
  assert.equal(formatDownloadPath("{author}/{title}.{ext}", nasty), "a_b_c/ok.jpg");
});

test("formatDownloadPath 的 {author} 优先用预解析 authorName（画师整理）", () => {
  // 调用方（persist-files）传规范化 + 别名后的值；路径库自己不认设置段
  const decorated = { ...ctx, author: "☆こいし★@pixiv", authorName: "こいし" };
  assert.equal(formatDownloadPath(DEFAULT_PATH_TEMPLATE, decorated), "こいし/12345_p0_无题.jpg");
  // 预解析值同样走非法字符清洗
  const nasty = { ...ctx, authorName: "a/b:c" };
  assert.equal(formatDownloadPath("{author}/{id}.{ext}", nasty), "a_b_c/12345.jpg");
  // 不给 authorName 时回退原样（老行为不变）
  assert.equal(formatDownloadPath("{author}/{id}.{ext}", { ...ctx, author: "☆こいし★" }), "☆こいし★/12345.jpg");
});

test("flattenDownloadName is used when the browser handles the file", () => {
  assert.equal(flattenDownloadName("こいし/12345_p0_无题.jpg"), "こいし_12345_p0_无题.jpg");
});

test("parsePathPreset falls back", () => {
  assert.equal(parsePathPreset("author"), "author");
  assert.equal(parsePathPreset("nope"), "author");
  assert.equal(templateForPreset("date"), "{date}/{id}_p{page}_{title}.{ext}");
});
