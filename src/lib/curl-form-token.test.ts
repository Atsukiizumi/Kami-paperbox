import assert from "node:assert/strict";
import { test } from "node:test";
import { formToken } from "./curl-fetch.server.ts";

test("-F 规格元字符转义：文件名注入部件参数的路径被拆掉（卫生批⑤）", () => {
  // 客户端文件名里夹 ;headers= ——落成下划线，curl 不再当部件参数解析
  assert.equal(formToken('a.jpg;headers="X-Evil: 1"'), "a.jpg_headers__X-Evil: 1_");
  assert.equal(formToken("x;type=text/html"), "x_type_text/html");
  assert.equal(formToken('q"uote\\back'), "q_uote_back");
  assert.equal(formToken("line\r\nbreak"), "line__break");
  // 正常文件名原样
  assert.equal(formToken("upload.jpg"), "upload.jpg");
  assert.equal(formToken("image/pixiv"), "image/pixiv");
});
