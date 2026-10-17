import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THROTTLE, parseThrottle } from "./throttle.ts";

test("parseThrottle fills defaults when throttle is missing", () => {
  assert.deepEqual(parseThrottle({ host: "0.0.0.0" }), DEFAULT_THROTTLE);
});

test("parseThrottle clamps mediaConcurrency", () => {
  assert.equal(parseThrottle({ throttle: { mediaConcurrency: 100 } }).mediaConcurrency, 32);
  assert.equal(parseThrottle({ throttle: { mediaConcurrency: 0 } }).mediaConcurrency, 1);
  assert.equal(parseThrottle({ throttle: { mediaConcurrency: 3 } }).mediaConcurrency, 3);
});

test("parseThrottle reads search gaps", () => {
  const t = parseThrottle({ throttle: { search: { ascii2d: 20000, saucenao: 1000 } } });
  assert.equal(t.search.ascii2d, 20_000);
  assert.equal(t.search.saucenao, 1_000);
  assert.equal(t.search.iqdb, DEFAULT_THROTTLE.search.iqdb);
});

test("parseThrottle 读 X 串行闸门间隔（xMinIntervalMs），缺省/越界回落", () => {
  // 缺省 = X_MIN_INTERVAL_MS 默认 1500（upstream/x.ts 同源常量，对齐写死防漂）
  assert.equal(parseThrottle({}).xMinIntervalMs, 1500);
  assert.equal(parseThrottle({ throttle: {} }).xMinIntervalMs, 1500);
  // 正常值透传；下限 250 / 上限 60_000 钳制
  assert.equal(parseThrottle({ throttle: { xMinIntervalMs: 3000 } }).xMinIntervalMs, 3000);
  assert.equal(parseThrottle({ throttle: { xMinIntervalMs: 10 } }).xMinIntervalMs, 250);
  assert.equal(parseThrottle({ throttle: { xMinIntervalMs: 999_999 } }).xMinIntervalMs, 60_000);
  // 脏值（NaN / 字符串数字外的垃圾）回落默认
  assert.equal(parseThrottle({ throttle: { xMinIntervalMs: NaN } }).xMinIntervalMs, 1500);
});
