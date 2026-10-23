/**
 * 主题包系统（everything can design · P2）。
 *
 * 作用：应用内闭环——导出当前为主题包（写进 themes/）→ 列表出现 → 启用
 *      （html 挂 data-kami-theme、跟随开关在场）→ 停用（标记与注入全摘）；
 *      _template 样板不出现在列表。CSS 清洗与 zip 路径由单测覆盖。
 * 注意：export/openDir 是本机写操作（需会话），先注册临时账号；GET 列表走 guest。
 */
import { expect, test } from "@playwright/test";

async function seedSettings(page: import("@playwright/test").Page, state: Record<string, unknown>, version = 18) {
  await page.addInitScript(({ s, v }) => {
    if (!localStorage.getItem("kami-settings")) {
      localStorage.setItem("kami-settings", JSON.stringify({ state: s, version: v }));
    }
  }, { s: state, v: version });
}

async function registerIfNeeded(page: import("@playwright/test").Page) {
  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  const email = page.locator("#app-account-email");
  try {
    await email.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return; // 账号关闭形态——不在本 spec 范围
  }
  await page.waitForFunction(() => {
    const input = document.querySelector("#app-account-email");
    return input instanceof HTMLInputElement && !input.disabled;
  }, undefined, { timeout: 60_000, polling: 500 });
  if (await page.getByText("已登录").count()) return;
  await email.fill(`kami-e2e-theme-${Date.now()}@example.com`);
  await page.locator("#app-account-password").fill("kami-e2e-pass-123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });
}

test("导出当前为主题包 → 列表出现 → 启用注入 → 停用复原", async ({ page }) => {
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 18);
  await registerIfNeeded(page);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "导出当前为主题包" }).click();
  await page.getByPlaceholder("比如：夜读").fill("e2e主题");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByText("已导出为主题包", { exact: false })).toBeVisible({ timeout: 15_000 });

  // 列表出现导出的包；_template 不在列表（说明文案里会出现这个词，只查列表行）
  const row = page.locator("li", { hasText: "e2e主题" }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("li", { hasText: "_template" })).toHaveCount(0);

  // 启用：html 挂激活标记；跟随开关在场
  await row.getByRole("button", { name: "启用" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-kami-theme", "e2e主题");
  await expect(row.getByRole("button", { name: "停用" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "主题跟随·外壳形态" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "主题跟随·案头布局" })).toBeVisible();

  // 停用：标记摘除、无 css 注入残留
  await row.getByRole("button", { name: "停用" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-kami-theme", /.+/);
  await expect(page.locator("style[data-kami-theme-css]")).toHaveCount(0);
});
