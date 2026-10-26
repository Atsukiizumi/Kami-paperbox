/**
 * 布局引擎 P1：案头编排 / 版式持久化 / 外壳三形态。
 *
 * 作用：三条红线——①出厂观感：v17 老档迁移后案头默认版式 = 合并版结构
 *      （登出态右栏三件套让位、铺纸提满宽）；②编排（键盘流）→ 存为版式 →
 *      刷新持久；③外壳三形态切换即时生效（属性 + 侧栏可见性）。
 * 注意：全部断言结构（data-* 属性/槽序），不依赖上游数据成败。
 */
import { expect, test } from "@playwright/test";
import assert from "node:assert/strict";

async function seedSettings(page: import("@playwright/test").Page, state: Record<string, unknown>, version = 17) {
  await page.addInitScript(({ s, v }) => {
    // 只在没种过时写：reload 后应用写回的最新档不能被 init script 盖掉。
    if (!localStorage.getItem("kami-settings")) {
      localStorage.setItem("kami-settings", JSON.stringify({ state: s, version: v }));
    }
  }, { s: state, v: version });
}

test("出厂红线：v17 老档迁移后案头默认版式与外壳即合并版观感", async ({ page }) => {
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 17);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-desk-module="browse-sheet"]')).toBeVisible({ timeout: 30_000 });

  // 外壳默认书案：属性 + 侧栏在场
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "desk");
  await expect(page.locator("aside.kami-aside")).toBeVisible();

  // 登出态（无追踪/无未读/未登录）：右栏三件套让位 → 铺纸提满宽、报纸通栏
  const slot0 = page.locator('[data-desk-slot="0"]');
  await expect(slot0.locator('[data-desk-module="browse-sheet"]')).toBeVisible();
  await expect(slot0).toHaveClass(/lg:col-span-3/);
  const slot1 = page.locator('[data-desk-slot="1"]');
  await expect(slot1.locator('[data-desk-module="newspaper"]')).toBeAttached();

  // 页宽默认纸宽（无覆盖属性生效的迹象：kami-content 仍是 6xl 档）
  await expect(page.locator("html")).toHaveAttribute("data-content-width", "paper");
});

test("编排：键盘流下场/上场 → 存为版式 → 刷新持久", async ({ page }) => {
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 17);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-desk-module="browse-sheet"]')).toBeVisible({ timeout: 30_000 });

  // 进编辑态（点页眉「编排」）——编辑期间页眉按钮让位给底部编排条的「完成」
  await page.getByRole("button", { name: "编排" }).click();
  await expect(page.getByRole("button", { name: /完成/ })).toBeVisible();

  // 键盘流（⑤ 焦点即选中）：聚焦报纸卡即选中（同步断言消除竞态）→ ← 跨槽搬进右栏槽
  const paperCard = page.locator('[data-desk-edit-card]', { hasText: "今日报纸" }).first();
  await paperCard.focus();
  await expect(paperCard).toBeFocused();
  await page.keyboard.press("ArrowLeft");

  // 存为版式：命名保存 → 自动退出编辑（内置稿纸不可写 → 存为是唯一出路）
  await page.getByRole("button", { name: "存为版式" }).click();
  await page.getByPlaceholder("比如：夜读版式").fill("e2e夜读");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "编排" })).toBeVisible({ timeout: 15_000 });

  // 刷新持久：激活指针与版式清单都落了，保存的版式确与默认稿纸不同
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-desk-module="browse-sheet"]')).toBeVisible({ timeout: 30_000 });
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem("kami-settings");
    const parsed = raw
      ? (JSON.parse(raw) as {
          state?: {
            deskPresets?: { id: string; name: string; layout: { slots: { items: string[] }[] } }[];
            activeDeskPresetId?: string;
          };
        })
      : {};
    const saved = parsed.state?.deskPresets?.find((p) => p.name === "e2e夜读");
    return {
      presets: parsed.state?.deskPresets?.length ?? 0,
      active: parsed.state?.activeDeskPresetId ?? "",
      savedSlots: saved?.layout.slots.map((s) => s.items) ?? null,
    };
  });
  expect(persisted.presets).toBeGreaterThanOrEqual(2);
  expect(persisted.active).not.toBe("kami-default");
  // 报纸进了右栏槽（与它独占末槽的默认稿纸不同）
  assert.ok(
    persisted.savedSlots?.some((items) => items.includes("newspaper") && items.length > 1),
    `报纸应与其他模块同槽，实际 ${JSON.stringify(persisted.savedSlots)}`,
  );
});

test("外壳三形态：书案 → 窄脊 → 无框即时切换（属性与可见性）", async ({ page }) => {
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 17);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  // 外壳三卡的可达名含描述文案，用子串匹配（exact 会撞全名）
  await page.getByRole("button", { name: "窄脊" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "rail");
  // 窄脊：图标条在场、顶栏仍常驻
  await expect(page.locator("aside.kami-aside")).toBeVisible();
  await expect(page.locator("header.kami-topbar")).toBeVisible();

  // 窄脊 + 顶栏「浮胶囊」：顶栏让位，右上浮胶囊接管
  await page.getByRole("button", { name: "浮胶囊" }).click();
  await expect(page.locator("header.kami-topbar")).toBeHidden();
  await expect(page.locator(".kami-float-controls")).toBeVisible();
  await page.getByRole("button", { name: "常驻" }).click();
  await expect(page.locator("header.kami-topbar")).toBeVisible();

  await page.getByRole("button", { name: "无框" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "zen");
  await expect(page.locator("aside.kami-aside")).toBeHidden();
  await expect(page.locator("header.kami-topbar")).toBeHidden();
  // zen：浮钮在场，面板可开合
  await page.getByRole("button", { name: "展开导航" }).click();
  await expect(page.getByRole("link", { name: /纸匣/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /纸匣/ }).first()).toBeHidden();

  // 回书案：一切复位
  await page.getByRole("button", { name: "书案" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "desk");
  await expect(page.locator("aside.kami-aside")).toBeVisible();
  await expect(page.locator("header.kami-topbar")).toBeVisible();
});

test("移动端红线：zen 形态下手机观感与现状一致（顶栏/底部栏在、浮胶囊不出）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 17);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "无框" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-shell-form", "zen");
  // 移动端：顶栏照旧（外壳形态只作用 md+）、浮胶囊不出、底部导航在
  await expect(page.locator("header.kami-topbar")).toBeVisible();
  await expect(page.locator(".kami-float-controls")).toBeHidden();
  await expect(page.locator("nav.kami-chrome-up")).toBeVisible();
});

test("⑤ 纯键盘编排：Tab 选中卡片 → 方向键搬移 → Delete 收起 → 托盘回场 → 存为版式（全程不碰鼠标）", async ({ page }) => {
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 18);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-desk-module="browse-sheet"]')).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "编排" }).click();
  await expect(page.getByRole("button", { name: /完成/ })).toBeVisible();

  // 纯键盘：Tab 流转到第一张卡片（role=button 的焦点卡）——不点鼠标
  const firstCard = page.locator('[data-desk-edit-card][role="button"]').first();
  await firstCard.focus();
  await expect(firstCard).toBeFocused();

  // 方向键左移（报纸在槽 2 → 槽 1）后 Delete 收起、托盘 Tab+Enter 回场
  const paperCard = page.locator('[data-desk-edit-card][role="button"]', { hasText: "今日报纸" }).first();
  await paperCard.focus();
  await expect(paperCard).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: "今日报纸", exact: true })).toBeVisible();

  // 托盘回场（Tab 到托盘按钮 + Enter——不点）
  const trayChip = page.getByRole("button", { name: "今日报纸", exact: true });
  await trayChip.focus();
  await trayChip.press("Enter");

  await page.getByRole("button", { name: "存为版式" }).click();
  await page.getByPlaceholder("比如：夜读版式").fill("键盘版式");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "编排" })).toBeVisible({ timeout: 15_000 });
});

test("⑥ 编辑式版式：内置第二版式切换即生效（左栏日期章+页脚+主副栏），默认稿纸零变化", async ({ page }) => {
  await seedSettings(page, { onboarded: true, tab: "pixiv" }, 18);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-desk-module="browse-sheet"]')).toBeVisible({ timeout: 30_000 });

  // 默认稿纸：无「今日的纸」文案、无日期章、无页脚（出厂红线不动的旁证；
  // 2026-10-26 起页眉统一并入左栏，日期章移至左栏底部且仅编辑式渲染）
  await expect(page.getByText("今日的纸")).toHaveCount(0);
  await expect(page.locator(".kami-dk-rail .kami-editorial-seal")).toHaveCount(0);
  await expect(page.getByText("今日也请多指教。")).toHaveCount(0);

  // 进编排切「编辑式」
  await page.getByRole("button", { name: "编排" }).click();
  await page.getByRole("button", { name: "编辑式" }).click();
  await expect(page.getByRole("button", { name: "完成" })).toBeVisible();

  // 编辑态左栏即出现日期章；页脚刻意只在非编辑态渲染（断言放到完成后）
  await expect(page.locator(".kami-dk-rail .kami-editorial-seal")).toBeVisible();

  // 完成退出：非编辑态仍有日期章与页脚；报纸在主栏（span2 槽首位）
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("button", { name: "编排" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".kami-dk-rail .kami-editorial-seal")).toBeVisible();
  await expect(page.getByText("今日也请多指教。")).toBeVisible();
  const firstSlot = page.locator('[data-desk-slot="0"]');
  await expect(firstSlot.locator('[data-desk-module="newspaper"]')).toBeAttached();

  // 刷新持久：编辑式仍是激活版式
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".kami-dk-rail .kami-editorial-seal")).toBeVisible({ timeout: 30_000 });
});
