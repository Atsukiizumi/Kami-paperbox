/**
 * 多设备同步场景（M3）：两个 browser context 同一应用账号。
 *
 * 断言：context A 注册 → 改可同步设置（「过滤 AI 作画」）→ 等 4s 防抖自动
 * 推送落库；context B（全新 context）同账号登录 → 拉取后设置与 A 一致。
 *
 * 全程只走设置页（不点任何会打 /api/source 的路径），对真实上游零依赖；
 * 注册 / 登录只经本机应用账号端点（better-auth + /api/account/sync，
 * e2e 专用 8090 + 仓库外临时根）。
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "kami-e2e-pass-123";

/** 应用账号表单提交（A 注册 / B 登录同一套表单）。 */
async function submitAppAccount(page: Page, email: string, action: "注册" | "登录") {
  const emailInput = page.locator("#app-account-email");
  await emailInput.waitFor({ state: "visible", timeout: 60_000 });
  // 账号开关形态 + 水合：表单就绪前是禁用的（critical-path 同款等待）
  await page.waitForFunction(
    () => {
      const input = document.querySelector("#app-account-email");
      return input instanceof HTMLInputElement && !input.disabled;
    },
    undefined,
    { timeout: 60_000, polling: 500 },
  );
  await emailInput.fill(email);
  await page.locator("#app-account-password").fill(PASSWORD);
  await page.getByRole("button", { name: action, exact: true }).click();
}

/** 浏览分区「过滤 AI 作画」开关（默认关；同分区还有 R-18 / 原图两个开关，按行文案定位）。 */
function aiFilterSwitch(page: Page) {
  return page
    .locator("div.flex.items-center.justify-between", { hasText: "过滤 AI 作画" })
    .getByRole("switch");
}

function seedOnboarded(): string {
  return `localStorage.setItem("kami-settings", JSON.stringify({ state: { onboarded: true, tab: "yande" }, version: 10 }));`;
}

test("A 改设置自动推送，B 同账号登录拉取一致", async ({ page, browser }) => {
  const errors: string[] = [];
  const email = `kami-e2e-sync-${Date.now()}@example.com`;

  // ── Context A：注册 + 改设置 + 4s 防抖自动推送 ────────────────────────────
  await page.addInitScript(seedOnboarded());
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  await submitAppAccount(page, email, "注册");
  await expect(page.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/settings#browse");
  const aiSwitchA = aiFilterSwitch(page);
  await expect(aiSwitchA).toBeVisible({ timeout: 30_000 });
  await aiSwitchA.click();

  // 等过 4s 防抖：settings 段自动推送落库（POST 200 是推送完成的确定性信号）
  const pushDone = page.waitForResponse(
    (r) =>
      r.url().includes("/api/account/sync") &&
      r.request().method() === "POST" &&
      (r.request().postData() ?? "").includes('"segment":"settings"') &&
      r.status() === 200,
    { timeout: 20_000 },
  );
  await pushDone;

  // ── Context B：同账号登录 → 拉取 → 设置一致 ──────────────────────────────
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await pageB.addInitScript(seedOnboarded());

  await pageB.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  await submitAppAccount(pageB, email, "登录");
  await expect(pageB.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });

  // 登录瞬间的自动拉取可能与 KEK 派生竞态（密码派生 KEK 落 sessionStorage 稍晚
  // 于 bridge 首拉，密文段会被跳过一次）——显式点「从服务端恢复」强制拉取，
  // 走的是同一条 pullAccountSync 通道，确定性不牺牲覆盖面。
  const restore = pageB.getByRole("button", { name: "从服务端恢复" });
  await expect(restore).toBeVisible({ timeout: 15_000 });
  await restore.click();

  await pageB.goto("/settings#browse");
  await expect(aiFilterSwitch(pageB)).toHaveAttribute("data-state", "checked", { timeout: 30_000 });

  // 存储层复核：持久化的 settings 段确实带着 A 的改动
  const hideAi = await pageB.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("kami-settings") ?? "{}") as { state?: { hideAi?: boolean } };
    return raw.state?.hideAi;
  });
  expect(hideAi).toBe(true);

  await contextB.close();
  expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
});
