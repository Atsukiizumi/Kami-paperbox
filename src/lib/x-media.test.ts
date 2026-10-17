/**
 * x-media（X 预览页纯函数，M6）单测。
 *
 * 作用：锁三条 M6 契约——
 *  1. xMediaQueryKey 含 handle + credentialTag（#204 复发守卫：换号 / 换 Cookie
 *     不得命中旧缓存分桶；仅大小写不同的 handle 共享分桶）；
 *  2. isXCookieGuideMessage 只认 x.ts 四条用户态文案（AC3 引导口径），上游
 *     429 / 网络错误不误入引导；
 *  3. findXLinkedAuthorId 沿用 M5「仅忽略记录不算关联」判据（x-link-card 头
 *     注释约定：所有读取处同一判据），restId 次级匹配兜改名。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { findXLinkedAuthorId, isXCookieGuideMessage, X_MEDIA_STALE_MS, xMediaQueryKey } from "./x-media.ts";
import { credentialTag } from "./sync/cred-tag.ts";
import type { XAssociation } from "./types.ts";

test("xMediaQueryKey：含 handle + credentialTag；换 Cookie 换分桶（#204 守卫），大小写归一", () => {
  const cookieA = credentialTag("auth_token=aaa; ct0=111");
  const cookieB = credentialTag("auth_token=bbb; ct0=222");
  const key = xMediaQueryKey("masara", cookieA);
  // 键形（design §5 / M6 契约）：["x-media", handle, credentialTag]
  assert.equal(key[0], "x-media");
  assert.equal(key.length, 3);
  assert.ok(key.includes("masara"), "键含 handle");
  assert.ok(key.includes(cookieA), "键含 credentialTag");
  // #204 守卫：换号后凭据指纹变 → 键变 → 不命中旧缓存
  assert.notEqual(
    JSON.stringify(xMediaQueryKey("masara", cookieA)),
    JSON.stringify(xMediaQueryKey("masara", cookieB)),
    "换 Cookie 必须换键",
  );
  // 未登录（空指纹）与已登录分桶；同凭据同键（稳定）
  assert.notEqual(JSON.stringify(xMediaQueryKey("h", "")), JSON.stringify(xMediaQueryKey("h", cookieA)));
  assert.deepEqual(xMediaQueryKey("masara", cookieA), xMediaQueryKey("masara", cookieA));
  // X screen_name 大小写不敏感：仅大小写不同的路径共享缓存分桶
  assert.deepEqual(xMediaQueryKey("Masara", cookieA), xMediaQueryKey("masara", cookieA));
  // handle 维度也在：不同 handle 不同键
  assert.notEqual(JSON.stringify(xMediaQueryKey("a", cookieA)), JSON.stringify(xMediaQueryKey("b", cookieA)));
  // staleTime 契约：10 分钟（R6 无自动轮询）
  assert.equal(X_MEDIA_STALE_MS, 10 * 60 * 1000);
});

test("isXCookieGuideMessage：x.ts 四条用户态文案进引导；429 / 网络错误不进", () => {
  const guides = [
    "未配置 X Cookie：到 设置 → 站点账号 填入（auth_token 与 ct0）",
    "X Cookie 不完整：需要同时带 auth_token 与 ct0 两个字段",
    "X Cookie 已失效，请到设置更新",
    "X 用户不存在或 Cookie 已失效",
  ];
  for (const message of guides) assert.ok(isXCookieGuideMessage(message), message);
  const notGuides = ["X 请求失败（429）", "X 接口报错：boom", "请求失败（502）", "fetch failed", "X 用户不存在或已改名"];
  for (const message of notGuides) assert.equal(isXCookieGuideMessage(message), false, message);
});

function assoc(over: Partial<XAssociation> & { handle: string }): XAssociation {
  return { origin: "manual", addedAt: 1, ...over };
}

test("findXLinkedAuthorId：在用关联反查回 authorId；大小写不敏感；restId 兜改名", () => {
  const table = {
    "pixiv:12345": assoc({ handle: "masara", restId: "777" }),
  };
  assert.equal(findXLinkedAuthorId(table, { handle: "masara" }), "12345");
  assert.equal(findXLinkedAuthorId(table, { handle: "Masara" }), "12345", "大小写不敏感");
  // 改名后 handle 对不上，restId 仍能反查（画师在 X 改名不失联）
  assert.equal(findXLinkedAuthorId(table, { handle: "newname", restId: "777" }), "12345");
  assert.equal(findXLinkedAuthorId(table, { handle: "newname" }), undefined, "handle / restId 都不匹配");
  assert.equal(findXLinkedAuthorId(table, { handle: "other" }), undefined);
  assert.equal(findXLinkedAuthorId(undefined, { handle: "masara" }), undefined, "旧档无段不炸");
});

test("findXLinkedAuthorId：仅忽略记录（handle ∈ 自己的 ignoredHandles）不算关联（M5 判据）", () => {
  // M5 约定：未关联时点「忽略」会建 handle 也在 ignoredHandles 里的仅忽略记录
  const table = {
    "pixiv:111": assoc({ handle: "someone", origin: "auto", ignoredHandles: ["someone"] }),
    "pixiv:222": assoc({ handle: "masara" }),
  };
  assert.equal(
    findXLinkedAuthorId(table, { handle: "someone" }),
    undefined,
    "仅忽略记录不当正式关联（不回链画师页）",
  );
  // 采纳后（handle 挪出 ignoredHandles）恢复反查；对其他候选的忽略不干扰
  const adopted = {
    "pixiv:111": assoc({ handle: "masara", origin: "manual", ignoredHandles: ["someone"] }),
  };
  assert.equal(findXLinkedAuthorId(adopted, { handle: "masara" }), "111", "转正后可反查");
  assert.equal(findXLinkedAuthorId(adopted, { handle: "someone" }), undefined, "仍被忽略的候选不反查");
  // 非 pixiv 前缀键（防御：authorKey 其他形态）不产出链接
  const oddKeys = { "n:画師A": assoc({ handle: "masara" }) };
  assert.equal(findXLinkedAuthorId(oddKeys, { handle: "masara" }), undefined);
});
