/**
 * 关键路径（M7）：浏览 → 详情 → 入队 → 纸匣。
 *
 * 用 yande（无需登录的图站）走完整链路：卡片点开详情、收入纸匣入队、
 * 队列页等完成、纸匣页看到条目。打真实上游，抖动靠 config 的 retry 兜。
 */
import { expect, test } from "@playwright/test";

/** 默认形态（VITE_AUTH_ENABLED=true）下数据面要会话：先注册一个临时账号。 */
async function registerIfNeeded(page: import("@playwright/test").Page) {
  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  const email = page.locator("#app-account-email");
  try {
    await email.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return; // 账号关闭形态（无表单）——数据面走 LAN 令牌，不在本 spec 范围
  }
  await page.waitForFunction(() => {
    const input = document.querySelector("#app-account-email");
    return input instanceof HTMLInputElement && !input.disabled;
  }, undefined, { timeout: 60_000, polling: 500 });
  if (await page.getByText("已登录").count()) return;
  await email.fill(`kami-e2e-${Date.now()}@example.com`);
  await page.locator("#app-account-password").fill("kami-e2e-pass-123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });
}

test("浏览 yande → 点开详情 → 收入纸匣 → 队列完成 → 纸匣可见", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  // 预置：跳过新手引导、默认站点 yande（无凭据也能出数据）
  await page.addInitScript(() => {
    localStorage.setItem(
      "kami-settings",
      JSON.stringify({ state: { onboarded: true, tab: "yande" }, version: 10 }),
    );
  });

  await registerIfNeeded(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = page.locator("article").first();
  await expect(card).toBeVisible({ timeout: 90_000 }); // 首次访问含 dev 编译 + 上游拉取

  // 点开第一张卡进详情（点卡片内的作品链接，避免命中悬停快捷按钮）
  const cardLink = card.locator('a[href^="/work/"]').first();
  await cardLink.click();
  await page.waitForURL(/\/work\/yande\//, { timeout: 30_000 });
  const save = page.getByRole("button", { name: "收入纸匣", exact: true }).first();
  await expect(save).toBeVisible({ timeout: 60_000 });
  await save.click();
  await expect(page.getByText("已加入队列：收入纸匣")).toBeVisible({ timeout: 15_000 });

  // 队列页：条目出现并跑到完成
  await page.goto("/queue", { waitUntil: "domcontentloaded" });
  const done = page.getByText("完成", { exact: true });
  await expect(done.first()).toBeVisible({ timeout: 120_000 });

  // 纸匣页：条目可见（瀑布流卡片是 article）
  await page.goto("/vault", { waitUntil: "domcontentloaded" });
  await expect(page.locator("article").first()).toBeVisible({ timeout: 30_000 });

  expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
});
