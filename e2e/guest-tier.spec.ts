/**
 * 访客层（未登录应用账号）：公开内容面可用，个人面仍要登录。
 *
 * 断言：匿名上下文能拉 yande 列表出卡片（修复前 401 全挂）；
 * /api/rankings 匿名可读；/api/vault 写仍 401。
 */
import { expect, test } from "@playwright/test";

test("访客能浏览公开内容，个人面仍需登录", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await page.addInitScript(() => {
    localStorage.setItem(
      "kami-settings",
      JSON.stringify({ state: { onboarded: true, tab: "yande" }, version: 10 }),
    );
  });

  // 匿名浏览：卡片应渲染（访客层放行 /api/source + /api/media）
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("article").first()).toBeVisible({ timeout: 90_000 });

  // 榜单归档：访客只读
  const rankings = await page.request.get("/api/rankings");
  expect(rankings.status()).toBe(200);

  // 个人面：纸匣写仍要会话
  const vault = await page.request.put("/api/vault");
  expect(vault.status()).toBe(401);

  expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
});
