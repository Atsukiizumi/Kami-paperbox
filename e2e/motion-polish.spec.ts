/**
 * 动效打磨 E2E（动效批 2026-10-25 · Task 2 起）。
 *
 * 作用：固定图卡夹具上的确定性别动效场景——浏览网格重排 FLIP、追加不重播、
 *   动效关闭直接落位。Task 3–5 在同一 spec 上扩预览/入队/灯箱与组合场景。
 * 用法：pnpm test:e2e e2e/motion-polish.spec.ts（隔离 8090 server，不碰真实数据）。
 * 为什么：动画连续性、临时节点释放这些行为只有真实浏览器能作证；夹具数据
 *   固定，几何断言才可复现（详见 fixtures/motion-study.ts）。
 */
import { expect, test } from "@playwright/test";
import { seedMotionStudy } from "./fixtures/motion-study";

test.describe("动效 · 悬停预览", () => {
  test("悬停打开、移出收起播放、滚动安全关闭", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text().slice(0, 200));
    });

    await seedMotionStudy(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("article")).toHaveCount(50, { timeout: 60_000 });

    const shell = page.locator('div[class*="z-[55]"]');
    const card = page.locator("article").first();

    // 悬停 520ms 触发预览：同一封面长大
    await card.hover();
    await expect(shell).toBeVisible({ timeout: 5_000 });
    await expect(shell.locator("img").first()).toBeVisible();

    // 移出：150ms 收回 FLIP 在播，随后浮层卸载
    await page.mouse.move(8, 8);
    await expect
      .poll(() => shell.evaluate((el) => el.getAnimations().length), { timeout: 1_500 })
      .toBeGreaterThan(0);
    await expect(shell).toHaveCount(0, { timeout: 2_000 });

    // 再悬停重新打开；整个往返无页面错误、无叠加节点
    await card.hover();
    await expect(shell).toBeVisible({ timeout: 5_000 });
    expect(await shell.count()).toBe(1);

    // 滚动导致锚点失效：预览安全收起
    await page.mouse.wheel(0, 900);
    await expect(shell).toHaveCount(0, { timeout: 2_000 });

    expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
  });
});

test.describe("动效 · 浏览网格重排", () => {
  test("固定图卡上屏、尾部追加不重播前部卡片", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    page.on("console", (m) => {
      // 「Failed to load resource」是网络面状态（如 /api/proxy 探测的预期 401），
      // 真异常会以 pageerror 或可读错误文本出现
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text().slice(0, 200));
    });

    await seedMotionStudy(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/browse/, { timeout: 30_000 });

    const board = page.locator(".kami-masonry");
    await expect(board).toHaveAttribute("data-packed", "", { timeout: 60_000 });
    // 首个列表页 50 张（BROWSE_PAGE_SIZE）
    await expect(page.locator("article")).toHaveCount(50, { timeout: 60_000 });

    // 标记首卡并记录几何
    const firstVars = await page.evaluate(() => {
      const el = document.querySelector(".kami-masonry > article") as HTMLElement | null;
      if (!el) return null;
      el.dataset.studyMark = "first";
      const css = el.style;
      return { x: css.getPropertyValue("--masonry-x"), y: css.getPropertyValue("--masonry-y"), w: css.getPropertyValue("--masonry-w") };
    });
    expect(firstVars).not.toBeNull();

    // 翻到末页（4 页 × 50 = 200 张池）：末页自动补拉两批（池 240 → 280），
    // 视图原地长到 50 张——追加路径在真实浏览器里走过（节点身份的确定性
    // 证明在 masonry-board.test.tsx 的 isSameNode 断言里，这里锁终态不变量）。
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.waitForTimeout(400);
    }
    await expect(page.locator("article")).toHaveCount(50, { timeout: 30_000 });
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
      const el = document.querySelector(".kami-masonry > article") as HTMLElement | null;
      if (!el) return { present: false };
      const link = el.querySelector('a[href^="/work/"]') as HTMLAnchorElement | null;
      const css = getComputedStyle(el);
      return {
        present: true,
        firstId: link?.href.match(/\/work\/yande\/(\d+)/)?.[1] ?? "",
        opacity: css.opacity,
        inview: el.hasAttribute("data-inview"),
        animations: el.getAnimations().length,
        willChange: el.style.willChange,
      };
    });
    expect(after.present).toBe(true);
    expect(after.firstId).toBe("1000200"); // 池第 201 张（末页首卡）
    expect(after.opacity).toBe("1");
    expect(after.inview).toBe(true);
    expect(after.animations).toBe(0);
    expect(after.willChange).toBe("");
    expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
  });

  test("视口变化触发可见卡片 FLIP，结束后落在新几何", async ({ page }) => {
    await seedMotionStudy(page, { motionEnabled: true });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("article")).toHaveCount(50, { timeout: 60_000 });
    await page.waitForTimeout(600);

    await page.setViewportSize({ width: 900, height: 800 });
    // 重排在 1~2 帧内开始：可见卡上有 WAAPI transform 动画
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const el = document.querySelector(".kami-masonry > article") as HTMLElement | null;
            return el ? el.getAnimations().length : 0;
          }),
        { timeout: 2_000 },
      )
      .toBeGreaterThan(0);

    // 动画结束后：无残余动画，几何已是新宽度的拼版结果
    await page.waitForTimeout(900);
    const settled = await page.evaluate(() => {
      const el = document.querySelector(".kami-masonry > article") as HTMLElement;
      return {
        animations: el.getAnimations().length,
        w: Number.parseFloat(el.style.getPropertyValue("--masonry-w")) || 0,
        willChange: el.style.willChange,
      };
    });
    expect(settled.animations).toBe(0);
    expect(settled.w).toBeGreaterThan(0);
    expect(settled.willChange).toBe("");
  });

  test("动效关闭：视口变化直接落位，零动画", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await seedMotionStudy(page, { motionEnabled: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("article")).toHaveCount(50, { timeout: 60_000 });
    await page.waitForTimeout(600);

    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const el = document.querySelector(".kami-masonry > article") as HTMLElement;
      return {
        animations: el.getAnimations().length,
        w: Number.parseFloat(el.style.getPropertyValue("--masonry-w")) || 0,
        opacity: getComputedStyle(el).opacity,
      };
    });
    expect(state.animations).toBe(0, "关停后零 WAAPI 动画");
    expect(state.w).toBeGreaterThan(0, "几何仍一次落位");
    expect(state.opacity).toBe("1");
    expect(errors).toEqual([]);
  });
});
