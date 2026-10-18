/**
 * browser-login.server 状态机单测：relayToken 生命周期（10-18 凭据竞态修复）。
 *
 * 作用：锁三件——① token 绝不进快照（getLoginJob / consume 的返回不含
 *      relayToken 字段，防回退红线）；② 终态复位（done 消费 / cancel 清空，
 *      error 与下一次 start 覆写见下方代码引用注释）；③ assertRelayToken
 *      的 timing-safe 语义（等长错值、长度不等、空值一律 false）。
 * 用法：随 pnpm test 的 tsx 段跑（.server 链需要 tsx 解析 @/ 别名；内容无 JSX，
 *      用 .tsx 后缀只为进 tsx loader 段，同 login-browser.test.tsx）。job 状态
 *      经 installLoginJobForTest 植入（仅测试用导出，同 setHostGuardInternalsForTests
 *      先例），绕过 Chrome 启动。
 * 为什么不起真 Chrome 测 start/error 路径：单测环境无法保证无浏览器且会真打
 *      上游；「下一次 start 覆写」与「runJob catch 复位」以代码引用留痕（AC5
 *      允许单测或代码引用）：startBrowserLogin 受理路径 `relayToken =
 *      randomBytes(32).toString("hex")` 覆写旧值；runJob 两处 catch 与
 *      startBrowserLogin 的 runJob.catch 均先 `relayToken = ""` 再置 error。
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { LoginJobSnapshot } from "./browser-login.ts";

const {
  assertRelayToken,
  cancelBrowserLogin,
  consumeLoginJobCredentials,
  getLoginJob,
  installLoginJobForTest,
} = await import("./browser-login.server.ts");
const { LOGIN_VIEW } = await import("./browser-login.ts");

const TOKEN = "ab".repeat(32); // 与 randomBytes(32).hex 同形：64 个 hex 字符
const PIXIV = "12345678_abcdef0123456789";

function snap(partial: Partial<LoginJobSnapshot> = {}): LoginJobSnapshot {
  return {
    status: "idle",
    site: null,
    error: null,
    chrome: null,
    relay: true,
    pageUrl: "",
    viewWidth: LOGIN_VIEW.width,
    viewHeight: LOGIN_VIEW.height,
    frame: null,
    pixiv: "",
    fanbox: "",
    x: "",
    pixivProfile: null,
    fanboxProfile: null,
    ...partial,
  };
}

beforeEach(() => {
  installLoginJobForTest(snap(), "");
});

test("assertRelayToken：正确 token 通过；等长错值 / 长度不等 / 空输入一律 false（timing-safe）", () => {
  installLoginJobForTest(snap({ status: "waiting", site: "pixiv" }), TOKEN);
  assert.equal(assertRelayToken(TOKEN), true);
  assert.equal(assertRelayToken("cd".repeat(32)), false, "等长错值走 timingSafeEqual false");
  assert.equal(assertRelayToken(TOKEN.slice(0, 32)), false, "长度不等先 false");
  assert.equal(assertRelayToken(""), false);
  assert.equal(assertRelayToken(null), false);
});

test("无 job（token 已复位为空）时对一切输入 false：401 优先于任何副作用", () => {
  assert.equal(assertRelayToken(""), false);
  assert.equal(assertRelayToken(TOKEN), false);
});

test("红线：getLoginJob 与 consumeLoginJobCredentials 的返回都不含 relayToken 字段", () => {
  installLoginJobForTest(snap({ status: "done", site: "pixiv", pixiv: PIXIV }), TOKEN);
  const polled = getLoginJob(true);
  assert.ok(!("relayToken" in polled), "轮询快照带 token = 广播给每个旁观者，修复失效");
  const withFrame = getLoginJob(true);
  assert.ok(!("relayToken" in withFrame));
  const consumed = consumeLoginJobCredentials();
  assert.ok(!("relayToken" in consumed), "取凭据响应同样不得回带 token");
  assert.equal(consumed.pixiv, PIXIV);
});

test("终态复位：done 消费（consumeLoginJobCredentials）清空 token，凭据单次交出保持", () => {
  installLoginJobForTest(snap({ status: "done", site: "pixiv", pixiv: PIXIV }), TOKEN);
  const first = consumeLoginJobCredentials();
  assert.equal(first.pixiv, PIXIV);
  assert.equal(assertRelayToken(TOKEN), false, "凭据交出的同时 token 失效");
  const second = consumeLoginJobCredentials();
  assert.equal(second.pixiv, "", "SEC-02 单次交出：二次为空");
});

test("终态复位：cancelBrowserLogin（waiting → error「已取消」）清空 token", async () => {
  installLoginJobForTest(snap({ status: "waiting", site: "pixiv", frame: "F" }), TOKEN);
  const snapAfter = await cancelBrowserLogin();
  assert.equal(snapAfter.status, "error");
  assert.equal(snapAfter.error, "已取消登录窗口");
  assert.equal(assertRelayToken(TOKEN), false, "取消即失效");
});

test("终态复位：cancel 对已 done（凭据未取）的 job 也清空 token，不残留可取凭据的会话", async () => {
  installLoginJobForTest(snap({ status: "done", site: "pixiv", pixiv: PIXIV }), TOKEN);
  await cancelBrowserLogin();
  assert.equal(assertRelayToken(TOKEN), false, "done 后取消同样终结 token");
});
