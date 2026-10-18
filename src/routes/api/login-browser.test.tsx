/**
 * /api/login-browser 路由级白名单回归。
 *
 * 作用：锁「未知 site 仍 400 + 文案枚举三站」——site 白名单本体（parseLoginSite
 *      放行 pixiv/fanbox/x）的纯函数测试在 browser-login.test.ts；这里只测
 *      路由 wiring：未知站在进 startBrowserLogin 之前就被拦下，不触 Chrome。
 * 用法：随 pnpm test 的 tsx 段跑（@/ 别名与 .server 链需要 tsx 解析，内容无 JSX）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { POST } = await import("@/routes/api/login-browser");

function post(site: unknown) {
  return POST(
    new Request("http://localhost:8080/api/login-browser", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site }),
    }),
  );
}

test("未知 site 仍 400，文案枚举三站", async () => {
  for (const bad of ["nosuch", "twitter", "", null]) {
    const res = await post(bad);
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
});
