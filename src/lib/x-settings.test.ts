/**
 * X 设置段清洗/解析（v16）：sanitizeXCookie、parseXAssociations、parseXQueryIdOverrides。
 *
 * 作用：锁「Cookie 只回收 auth_token+ct0 两字段、缺一即空」「关联表坏条目丢弃、
 *       上限截取」「queryId 只认三个键、空值=未覆盖」三条口径——store 迁移、
 *       备份解析、服务端会话镜像共用这套函数，这里绿三处就都绿。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  X_ASSOCIATION_LIMIT,
  parseXAssociations,
  parseXQueryIdOverrides,
  sanitizeXCookie,
} from "./x-settings.ts";

const TOKEN = "a".repeat(40);
const CT0 = "b".repeat(40);

test("sanitizeXCookie：两字段齐全拼规范形态，整段 DevTools 头也只留这两项", () => {
  assert.equal(sanitizeXCookie(`auth_token=${TOKEN}; ct0=${CT0}`), `auth_token=${TOKEN}; ct0=${CT0}`);
  // 整段请求头（含 guest_id / twid 等噪声字段、大小写、乱序）→ 收敛成规范两段
  assert.equal(
    sanitizeXCookie(
      `guest_id=v1%3A123; kdt=xyz; ct0=${CT0}; twid=u%3D1; auth_token=${TOKEN}; auth_multi=noise`,
    ),
    `auth_token=${TOKEN}; ct0=${CT0}`,
  );
  // 前缀 @ 无关的裸值 / 空串 / undefined
  assert.equal(sanitizeXCookie(""), "");
  assert.equal(sanitizeXCookie(undefined), "");
  assert.equal(sanitizeXCookie("not a cookie at all"), "");
});

test("sanitizeXCookie：缺任一字段返回空串（时间线接口两者都必需）", () => {
  assert.equal(sanitizeXCookie(`auth_token=${TOKEN}`), "");
  assert.equal(sanitizeXCookie(`ct0=${CT0}`), "");
  assert.equal(sanitizeXCookie(`auth_token=short; ct0=${CT0}`), "", "auth_token 太短当噪声");
});

test("parseXAssociations：好条目保留（@ 前缀剥掉），坏条目丢弃，缺省补空表", () => {
  assert.deepEqual(parseXAssociations(undefined), {});
  assert.deepEqual(parseXAssociations("junk"), {});
  assert.deepEqual(parseXAssociations([1, 2]), {});
  const good = parseXAssociations({
    "pixiv:11": { handle: "@masara", restId: "123", origin: "manual", addedAt: 1 },
    "pixiv:12": { handle: "yone", origin: "auto", addedAt: 2, ignoredHandles: ["@spam", "spam", "bad handle", ""] },
    // 坏条目：handle 非法 / origin 未知 / 值不是对象
    "pixiv:13": { handle: "has space", origin: "auto", addedAt: 1 },
    "pixiv:14": { handle: "ok_handle", origin: "weird", addedAt: 1 },
    "pixiv:15": "junk",
    "": { handle: "orphan", origin: "auto", addedAt: 1 },
  });
  assert.deepEqual(good, {
    "pixiv:11": { handle: "masara", restId: "123", origin: "manual", addedAt: 1 },
    "pixiv:12": { handle: "yone", origin: "auto", addedAt: 2, ignoredHandles: ["spam"] },
  });
});

test("parseXAssociations：脏 restId 丢字段、ignoredHandles 去重截取、超限截断", () => {
  const one = parseXAssociations({
    k: { handle: "h", restId: "12a", origin: "auto", addedAt: 1, ignoredHandles: Array.from({ length: 60 }, (_, i) => `x${i}`) },
  });
  assert.equal(one.k?.restId, undefined, "restId 非纯数字丢字段");
  assert.equal(one.k?.ignoredHandles?.length, 50, "ignoredHandles 截到 50");
  const many: Record<string, unknown> = {};
  for (let i = 0; i < X_ASSOCIATION_LIMIT + 5; i += 1) {
    many[`pixiv:${i}`] = { handle: `h${i}`, origin: "auto", addedAt: i };
  }
  assert.equal(Object.keys(parseXAssociations(many)).length, X_ASSOCIATION_LIMIT, "超限截取");
});

test("parseXQueryIdOverrides：只认三个键，空值/脏值/未知键丢弃", () => {
  assert.deepEqual(parseXQueryIdOverrides(undefined), {});
  assert.deepEqual(parseXQueryIdOverrides("junk"), {});
  assert.deepEqual(
    parseXQueryIdOverrides({
      userByScreenName: " NewId_1 ",
      userMedia: "",
      tweetResult: "has space",
      unknownKey: "whatever",
    }),
    { userByScreenName: "NewId_1" },
  );
  // 未知键整张表带进来也只挑三个已知键（宽松解析：类型不对给默认值）
  assert.deepEqual(parseXQueryIdOverrides({ tweetResult: 42, userMedia: null }), {});
});
