/**
 * /api/login-browser 路由级白名单 + relayToken 门槛回归。
 *
 * 作用：锁「未知 site 仍 400 + 文案枚举三站」——site 白名单本体（parseLoginSite
 *      放行 pixiv/fanbox/x）的纯函数测试在 browser-login.test.ts；这里只测
 *      路由 wiring：未知站在进 startBrowserLogin 之前就被拦下，不触 Chrome。
 *      relayToken（10-18 凭据竞态修复）：除 start 外全部 action 第一步校验——
 *      无/错 token 的 poll（含 credentials=1）/ input / cancel 一律 401 固定
 *      错误体且零副作用；正确 token 放行、凭据单次消费；start 响应形状。
 *      P1 修复再加锁：error 终态保留 token 供发起方单次补读（403 / 超时文案
 *      直达轮询方，读到即清 + 60s TTL；错 token 照旧 401 三键体）。
 * 用法：随 pnpm test 的 tsx 段跑（@/ 别名与 .server 链需要 tsx 解析，内容无 JSX）。
 *      job 状态经 installLoginJobForTest 植入（仅测试用导出，不触 Chrome）。
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { LoginJobSnapshot } from "@/lib/sync/browser-login";

const { GET, POST, startLoginResponse } = await import("@/routes/api/login-browser");
const { assertRelayToken, installLoginJobForTest } = await import("@/lib/sync/browser-login.server");
const { LOGIN_VIEW, X_RELAY_403_HINT } = await import("@/lib/sync/browser-login");

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

function get(path: string) {
  return GET(new Request(`http://localhost:8080/api/login-browser${path}`));
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost:8080/api/login-browser", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  installLoginJobForTest(snap(), "");
});

test("未知 site 仍 400，文案枚举三站", async () => {
  for (const bad of ["nosuch", "twitter", "", null]) {
    const res = await post({ site: bad });
    assert.equal(res.status, 400, `site=${String(bad)} 必须被白名单拦下`);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.match(String(body.error), /pixiv、fanbox 或 x/);
  }
});

test("非 JSON body 也是 400，不触中转", async () => {
  const res = await POST(
    new Request("http://localhost:8080/api/login-browser", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, false, "解析失败也不回 job 快照（abort 分支已收紧为固定体）");
});

// ── relayToken 门槛（AC1/AC2/AC3）──────────────────────────────────────────

test("帧轮询：无/错 token → 401 固定错误体（不回帧、不泄 job 状态）；正确 token 放行", async () => {
  installLoginJobForTest(
    snap({ status: "waiting", site: "pixiv", pageUrl: "https://accounts.pixiv.net/login", frame: "JPEGDATA" }),
    TOKEN,
  );
  for (const q of ["?frame=1", "?frame=1&relayToken=wrong", `?frame=1&relayToken=${TOKEN.slice(0, 8)}`]) {
    const res = await get(q);
    assert.equal(res.status, 401, q);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["error", "ok", "status"], "401 体只有固定三键，无任何 job 状态");
    assert.equal(body.ok, false);
    assert.equal(body.error, "登录中转校验失败");
  }
  // 对照组：正确 token 拿到帧——证明上面拦的是 token，不是 job 状态
  const okRes = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(okRes.status, 200);
  const okBody = (await okRes.json()) as Record<string, unknown>;
  assert.equal(okBody.frame, "JPEGDATA");
  assert.ok(!("relayToken" in okBody), "轮询响应绝不回带 token（红线）");
});

test("credentials=1：无/错 token → 401 且凭据未消费；正确 token 单次消费，之后连正确 token 也 401", async () => {
  installLoginJobForTest(snap({ status: "done", site: "pixiv", pixiv: PIXIV }), TOKEN);
  for (const q of ["?credentials=1", "?credentials=1&relayToken=nope"]) {
    const res = await get(q);
    assert.equal(res.status, 401, q);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.ok(!("pixiv" in body), "凭据一个字都不给");
  }
  // 凭据还在（错误尝试没有消费它）
  assert.equal(assertRelayToken(TOKEN), true, "错误尝试不影响 token 有效性");
  const take = await get(`?credentials=1&relayToken=${TOKEN}`);
  assert.equal(take.status, 200);
  const taken = (await take.json()) as Record<string, unknown>;
  assert.equal(taken.pixiv, PIXIV);
  // 消费即失效：同一 token 二次取凭据 → 401（比「为空」更强：信息更少）
  const again = await get(`?credentials=1&relayToken=${TOKEN}`);
  assert.equal(again.status, 401, "SEC-02 单次交出：消费后 token 已复位");
});

test("input：无/错 token → 401，dispatchLoginInput 不可达（无法注入他人 job），job 状态不变", async () => {
  installLoginJobForTest(snap({ status: "waiting", site: "pixiv", frame: "F" }), TOKEN);
  const inputs = [
    { action: "input", event: { type: "text", text: "x" } },
    { action: "input", event: { type: "text", text: "x" }, relayToken: "wrong" },
    { action: "input", event: { type: "text", text: "x" }, relayToken: TOKEN.slice(0, 8) },
  ];
  for (const body of inputs) {
    const res = await post(body);
    assert.equal(res.status, 401, JSON.stringify(body));
    const resBody = (await res.json()) as Record<string, unknown>;
    assert.equal(resBody.ok, false);
    assert.equal(resBody.error, "登录中转校验失败");
  }
  // 若门槛失效，dispatchLoginInput 会在无 activePage 时抛「没有进行中的登录窗口」→
  // 路由兜成 400；拿到 401 即证明 dispatch 根本没被触达。再用正确 token 轮询验证状态未动：
  const polled = await get(`?frame=1&relayToken=${TOKEN}`);
  const polledBody = (await polled.json()) as Record<string, unknown>;
  assert.equal(polledBody.status, "waiting", "job 状态不变");
  assert.equal(polledBody.frame, "F", "帧未被门侧副作用触碰");
});

test("cancel：无/错 token → 401 且 job 不被取消（旁观者不能替人关窗）", async () => {
  installLoginJobForTest(snap({ status: "waiting", site: "pixiv" }), TOKEN);
  for (const body of [{ action: "cancel" }, { action: "cancel", relayToken: "wrong" }]) {
    const res = await post(body);
    assert.equal(res.status, 401, JSON.stringify(body));
  }
  const after = await get(`?frame=0&relayToken=${TOKEN}`);
  const afterBody = (await after.json()) as Record<string, unknown>;
  assert.equal(afterBody.status, "waiting", "job 仍在等待，未被旁观请求取消");
});

test("start 响应形状：token 仅此一次外发 + 快照剥串照旧；启动失败不外发 token（AC1）", () => {
  const body = startLoginResponse({
    snapshot: snap({
      status: "waiting",
      site: "pixiv",
      pixiv: PIXIV,
      fanbox: PIXIV,
      x: "auth_token=a; ct0=b",
      frame: "FR",
    }),
    relayToken: TOKEN,
  });
  assert.equal(body.ok, true);
  assert.equal(body.relayToken, TOKEN, "token 只在 start 响应出现");
  assert.equal(body.pixiv, "", "start 响应快照照旧剥串（SEC-02）");
  assert.equal(body.fanbox, "");
  assert.equal(body.x, "");
  const failed = startLoginResponse({
    snapshot: snap({ status: "error", site: "pixiv", error: "缺 Chrome" }),
    relayToken: "",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.relayToken, "", "error 终态（token 已复位）得到空串");
});

// ── P1 修复：error 终态对持正确 token 的发起方单次可读 ────────────────────────
// 断链回顾：error 立即清 token → 发起方下一次 280ms 轮询 401 → 前端孤儿文案
// （「后台仍在进行」），X_RELAY_403_HINT / 超时文案展示不出来。现在 error 终态
// 保留 token，读到错误文案这一次即消费；错 token / 无 token 照旧 401 三键体。

test("error 终态（403 文案）：正确 token 轮询一次拿到 status:error + 文案；补读即消费，再轮询 401", async () => {
  installLoginJobForTest(snap({ status: "error", site: "x", error: X_RELAY_403_HINT }), TOKEN);
  const first = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(first.status, 200, "发起方带正确 token 能读到错误终态");
  const body = (await first.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.status, "error");
  assert.equal(body.error, X_RELAY_403_HINT, "403 引导文案直达发起方");
  assert.equal(assertRelayToken(TOKEN), false, "读到即清：单次补读，防重放");
  const second = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(second.status, 401, "同一 token 二次轮询 401（补读已消费）");
});

test("error 终态：错 token / 无 token 仍 401 固定三键体（红线：不泄终态与文案），且不消费补读资格", async () => {
  installLoginJobForTest(snap({ status: "error", site: "x", error: X_RELAY_403_HINT }), TOKEN);
  for (const q of ["?frame=1", "?frame=1&relayToken=wrong", `?frame=1&relayToken=${TOKEN.slice(0, 8)}`]) {
    const res = await get(q);
    assert.equal(res.status, 401, q);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["error", "ok", "status"], "401 体只有固定三键，无 job 状态");
    assert.equal(body.error, "登录中转校验失败");
  }
  // 对照组：错误尝试不消费补读资格，正确 token 仍可读
  const okRes = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(okRes.status, 200);
  assert.equal(assertRelayToken(TOKEN), false, "这次对照读取才消费");
});

test("存量断链一并修复：超时终态错误同样对发起方单次可读", async () => {
  installLoginJobForTest(
    snap({
      status: "error",
      site: "x",
      error: "超时未检测到 X 登录。请在窗口里完成登录（含可能的验证码 / 2FA），或改用手贴。",
    }),
    TOKEN,
  );
  const res = await get(`?frame=0&relayToken=${TOKEN}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.status, "error");
  assert.match(String(body.error), /超时未检测到 X 登录/);
  assert.equal(assertRelayToken(TOKEN), false, "超时文案送达即清 token");
});

test("done 终态不回归：帧轮询不清 token（凭据通道还要用），凭据仍单次消费", async () => {
  installLoginJobForTest(snap({ status: "done", site: "x", x: "auth_token=a; ct0=b" }), TOKEN);
  const frame = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(frame.status, 200);
  const frameBody = (await frame.json()) as Record<string, unknown>;
  assert.equal(frameBody.x, "", "帧轮询照旧剥串");
  assert.equal(assertRelayToken(TOKEN), true, "done 的帧轮询不消费 token");
  const cred = await get(`?credentials=1&relayToken=${TOKEN}`);
  const credBody = (await cred.json()) as Record<string, unknown>;
  assert.equal(credBody.x, "auth_token=a; ct0=b");
  const again = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(again.status, 401, "凭据消费后 token 失效照旧（SEC-02 单次交出）");
});

test("error 终态 60s TTL 兜底：窗口已过时正确 token 也 401（发起方一直没来读）", async () => {
  installLoginJobForTest(snap({ status: "error", site: "x", error: X_RELAY_403_HINT }), TOKEN, Date.now() - 1);
  const res = await get(`?frame=1&relayToken=${TOKEN}`);
  assert.equal(res.status, 401, "补读窗口过期：不无限滞留");
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["error", "ok", "status"], "过期 401 同固定三键体");
});
