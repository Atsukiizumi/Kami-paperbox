/**
 * mask()（Cookie 脱敏文案）就地测试。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mask } from "./mask.ts";

describe("settings/account mask（Cookie 脱敏文案）", () => {
  it("空值显示未填写", () => {
    assert.equal(mask(""), "未填写");
  });
  it("短值（≤6）只显示已保存，不露字符", () => {
    assert.equal(mask("abc123"), "已保存");
  });
  it("长值只露尾 4 位", () => {
    assert.equal(mask("12345678_wxyz1234"), "已保存 · …1234");
  });
});
