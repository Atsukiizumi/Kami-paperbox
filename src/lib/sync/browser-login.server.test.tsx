/**
 * browser-login.server 状态机单测：relayToken 生命周期（10-18 凭据竞态修复）。
 *
 * 作用：锁三件——① token 绝不进快照（getLoginJob / consume 的返回不含
 *      relayToken 字段，防回退红线）；② 终态复位（done 消费 / cancel 清空，
 *      error 与下一次 start 覆写见下方代码引用注释）；③ assertRelayToken
 *      的 timing-safe 语义（等长错值、长度不等、空值一律 false）。
 *      P1 修复再加锁：error 终态保留 token 单次补读（readLoginJobForRelay
 *      读到即清）+ 60s TTL 兜底——403 / 超时文案对发起方可达。
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
  readLoginJobForRelay,
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

// ── P1 修复：error 终态保留 token 单次补读（403 / 超时文案可达） ────────────────

test("readLoginJobForRelay：error 终态返回快照并单次消费 token；waiting / done 不消费", () => {
  installLoginJobForTest(snap({ status: "waiting", site: "x", frame: "F" }), TOKEN);
  const waiting = readLoginJobForRelay(true);
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.frame, "F");
  assert.equal(assertRelayToken(TOKEN), true, "进行中 job 的帧轮询不消费 token");

  installLoginJobForTest(snap({ status: "error", site: "x", error: "X 拒绝了自动浏览器（HTTP 403）" }), TOKEN);
  const failed = readLoginJobForRelay(true);
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "X 拒绝了自动浏览器（HTTP 403）");
  assert.equal(assertRelayToken(TOKEN), false, "error 补读单次：文案送达即清 token");

  installLoginJobForTest(snap({ status: "done", site: "x", x: "auth_token=a; ct0=b" }), TOKEN);
  readLoginJobForRelay(true);
  assert.equal(assertRelayToken(TOKEN), true, "done 的帧轮询不消费 token（凭据通道还要用）");
});

test("error 补读窗口 60s TTL：过期后正确 token 也失效（发起方一直没来读的兜底）", () => {
  installLoginJobForTest(snap({ status: "error", site: "x", error: "boom" }), TOKEN, Date.now() - 1);
  assert.equal(assertRelayToken(TOKEN), false, "窗口已过：惰性作废");
  assert.equal(assertRelayToken(TOKEN), false, "token 已被作废路径清除");
});

test("生产守卫：NODE_ENV=production 时 installLoginJobForTest 抛错且不触碰既有状态（R3）", () => {
  // 判定在调用时读 env（非模块加载时），注入生产值即可覆盖守卫分支。
  // NODE_ENV 在 next-env 类型里是 readonly 声明，写值走 Object.assign 绕过。
  installLoginJobForTest(snap({ status: "waiting", site: "pixiv" }), TOKEN);
  const original = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    assert.throws(
      () => installLoginJobForTest(snap({ status: "done", site: "pixiv", pixiv: PIXIV }), "ff".repeat(32)),
      /仅测试可用/,
      "生产环境植入中转状态必须抛错",
    );
    assert.equal(assertRelayToken(TOKEN), true, "抛错路径零副作用：既有 job/token 原样");
    assert.equal(getLoginJob().status, "waiting", "快照未被植入覆盖");
  } finally {
    if (original === undefined) delete (process.env as { NODE_ENV?: string }).NODE_ENV;
    else Object.assign(process.env, { NODE_ENV: original });
  }
  // 还原后植入器照常可用（开发/测试环境不受守卫影响）
  installLoginJobForTest(snap({ status: "waiting", site: "pixiv" }), "ee".repeat(32));
  assert.equal(assertRelayToken("ee".repeat(32)), true);
});
