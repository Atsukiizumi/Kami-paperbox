import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asBool,
  asNumber,
  asRecord,
  asRecordOrNull,
  asRecordStrict,
  asString,
  asStringLoose,
  asStringTrimmed,
} from "./parse.ts";

describe("parse 四件套变体（TD-32：语义命名化，行为保真）", () => {
  it("asRecord 宽松：数组通过；asRecordStrict 排除数组；asRecordOrNull 区分 null", () => {
    const arr = ["a"];
    assert.deepEqual(asRecord(arr), arr);
    assert.deepEqual(asRecordStrict(arr), {});
    assert.equal(asRecordOrNull(arr), null);
    assert.deepEqual(asRecord("x", { d: 1 }), { d: 1 });
    assert.deepEqual(asRecordStrict("x"), {});
    assert.equal(asRecordOrNull(null), null);
    assert.deepEqual(asRecordOrNull({ a: 1 }), { a: 1 });
  });

  it("asString 三变体：bool 感知 / 朴素 / trim", () => {
    assert.equal(asString(true), "true");
    assert.equal(asString(false), "false");
    assert.equal(asString(12), "12");
    assert.equal(asString(undefined, "fb"), "fb");
    assert.equal(asStringLoose(true), "");
    assert.equal(asStringLoose(12), "12");
    assert.equal(asStringTrimmed("  x  "), "x");
    assert.equal(asStringTrimmed(true), "");
    assert.equal(asStringTrimmed(3), "3");
  });

  it("asNumber 与 asBool 与 http 家族语义一致", () => {
    assert.equal(asNumber("42"), 42);
    assert.equal(asNumber("", 7), 7);
    assert.equal(asNumber("nope"), 0);
    assert.equal(asNumber(1.5), 1.5);
    assert.equal(asBool(true), true);
    assert.equal(asBool("true"), false);
    assert.equal(asBool(1), false);
  });
});
