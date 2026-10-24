/**
 * 外壳全参数（P3 custom 形态）。
 *
 * 作用：自定义卡片 → 参数组合 → 结构守卫（隐藏侧栏=浮钮导航、右置=胶囊翻左）
 *      → 刷新持久 → 回书案复原。宽度钳制/守卫矩阵由单测表驱动覆盖。
 */
import { expect, test } from "@playwright/test";

async function seedSettings(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("kami-settings")) {
      localStorage.setItem("kami-settings", JSON.stringify({ state: { onboarded: true, tab: "pixiv" }, version: 19 }));
    }
  });
}

test("custom：隐藏侧栏走浮钮导航、右置胶囊翻左、刷新持久、回书案复原", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });

  // 进自定义（默认全字侧栏）
  await page.getByRole("button", { name: "自定义" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "custom");
  await expect(page.locator("aside.kami-aside")).toBeVisible();
  await expect(page.locator(".kami-float-controls")).toBeHidden();

  // 顶栏关 → 胶囊在右上（默认左侧栏）
  await page.getByRole("switch", { name: "顶栏显示" }).click();
  await expect(page.locator("header.kami-topbar")).toBeHidden();
  await expect(page.locator(".kami-float-controls")).toBeVisible();
  await expect(page.locator(".kami-float-controls")).not.toHaveClass(/kami-float-left/);

  // 侧栏隐藏 → aside 消失、浮钮面板接管导航
  await page.getByRole("button", { name: "隐藏", exact: true }).click();
  await expect(page.locator("aside.kami-aside")).toBeHidden();
  await expect(page.getByRole("button", { name: "展开导航" })).toBeVisible();
  await page.getByRole("button", { name: "展开导航" }).click();
  await expect(page.getByRole("link", { name: /纸匣/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // 位置右侧（隐藏态下也能设）→ data-shell-side=right；胶囊翻左避让
  await page.getByRole("button", { name: "右侧" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-side", "right");
  await expect(page.locator(".kami-float-controls")).toHaveClass(/kami-float-left/);

  // 刷新持久
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "custom");
  await expect(page.locator("html")).toHaveAttribute("data-shell-side", "right");
  await expect(page.locator("aside.kami-aside")).toBeHidden();

  // 回书案复原
  await page.getByRole("button", { name: "书案" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "desk");
  await expect(page.locator("aside.kami-aside")).toBeVisible();
  await expect(page.locator("header.kami-topbar")).toBeVisible();
  await expect(page.locator(".kami-float-controls")).toBeHidden();
});
