// @ts-check
/**
 * fetch-upstream-fixtures 的脱敏单测（M1）。
 *
 * 作用：锁 sanitizeUpstreamPayload 的凭据删除口径与 publicUrl 的 origin+pathname
 *      口径——fixtures 入库前唯一的机器闸，脱敏口径一变这里先红。
 * 用法：pnpm test 第 1 段（node --test 收 scripts 下 *.test.mjs）自动执行。
 * 为什么：凭据零入库是人工 grep 闸 + 这层单测双防线；纯函数不改入参也是
 *      「脚本可重复跑」的前提。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDENTIAL_KEY_RE, SANITIZER_VERSION, publicUrl, sanitizeUpstreamPayload } from "./fetch-upstream-fixtures.mjs";

test("sanitize：凭据形键整键删除（大小写不敏感，覆盖全部正则分支）", () => {
  const dirty = {
    PHPSESSID: "abc",
    sessid: "abc",
    refreshToken: "abc",
    csrfToken: "abc",
    client_secret: "abc",
    Authorization: "Bearer abc",
    api_key: "abc",
    apiKey: "abc",
    "X-API-KEY": "abc",
    keepMe: 1,
  };
  assert.deepEqual(sanitizeUpstreamPayload(dirty), { keepMe: 1 });
});

test("sanitize：递归进嵌套对象与数组，其余结构原样", () => {
  const dirty = {
    meta: { session_token: "x", nested: [{ AccessToken: "y" }, { ok: "z" }] },
    list: ["plain", { secret_api_key: 1, set_cookie: "drop-me" }],
  };
  assert.deepEqual(sanitizeUpstreamPayload(dirty), {
    meta: { nested: [{}, { ok: "z" }] },
    list: ["plain", {}],
  });
});

test("sanitize：原始值与 null 原样通过", () => {
  assert.equal(sanitizeUpstreamPayload("text"), "text");
  assert.equal(sanitizeUpstreamPayload(42), 42);
  assert.equal(sanitizeUpstreamPayload(null), null);
  assert.deepEqual(sanitizeUpstreamPayload([]), []);
});

test("sanitize：纯函数——不改入参（重复抓取/覆盖写入依赖这一点）", () => {
  const dirty = { posts: [{ id: 1, token: "x" }] };
  const snapshot = JSON.stringify(dirty);
  sanitizeUpstreamPayload(dirty);
  assert.equal(JSON.stringify(dirty), snapshot);
});

test("publicUrl：query 与 hash 全弃，origin+pathname 保留", () => {
  assert.equal(publicUrl("https://yande.re/post.json?limit=20"), "https://yande.re/post.json");
  assert.equal(
    publicUrl("https://www.pixiv.net/ranking.php?mode=daily&content=illust&p=1&format=json"),
    "https://www.pixiv.net/ranking.php",
  );
  assert.equal(
    publicUrl("https://www.pixiv.net/ajax/illust/1?lang=zh#frag"),
    "https://www.pixiv.net/ajax/illust/1",
  );
});

test("脱敏口径的元常数存在且成对（_meta 里写的就是它们）", () => {
  assert.equal(typeof SANITIZER_VERSION, "number");
  assert.ok(CREDENTIAL_KEY_RE.test("PHPSESSID"));
  assert.ok(!CREDENTIAL_KEY_RE.test("illust_id"));
});
