/**
 * 浏览缓存回归（M7 收编自 scripts/qa-browse-cache.mjs）。
 *
 * 核心：种一条 2 小时前的过期 home 缓存，先开非浏览页——不该炸
 * "Missing queryFn"（hydrate 后台刷新只能打有观察者的键）；回浏览页时
 * 旧列表先画、超时后自动补刷。
 */
import { expect, test } from "@playwright/test";

test("过期浏览缓存不炸 Missing queryFn，回浏览页自动补刷", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });

  await page.addInitScript(() => {
    localStorage.setItem("kami-settings", JSON.stringify({ state: { onboarded: true }, version: 10 }));
    // 2 小时前的 home-pixiv 日榜缓存：无下一页，能出数据只能靠「过期补刷」
    const key = [
      "home-pixiv",
      "daily",
      "",
      { age: "all", bookmarks: "0", order: "date_d", ratio: "all", scope: "s_tag", type: "all", when: "any" },
      true,
      false,
      "",
      "2026-09-09",
    ];
    localStorage.setItem(
      "kami-browse-v1",
      JSON.stringify({
        queries: [
          {
            queryKey: key,
            queryHash: JSON.stringify(key),
            state: {
              data: { pages: [{ op: "pixivRanking", date: "20260909", items: [], nextPage: null }], pageParams: [1] },
              dataUpdatedAt: Date.now() - 2 * 60 * 60 * 1000,
              status: "success",
              fetchStatus: "idle",
            },
          },
        ],
      }),
    );
  });

  // 1) 带过期缓存直接开非浏览页：不应炸 Missing queryFn
  await page.goto("/vault", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const missing = errors.filter((e) => e.includes("queryFn"));
  expect(missing, `相关错误 ${missing.length} 条`).toEqual([]);

  // 2) 回浏览页：旧列表先画，超时后自动补刷（补刷出卡片依赖 Pixiv 上游
  //    与凭据，CI 无 cookie 时可能拉不到——回归点是「不炸」，补刷只做软观察）
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const skip = page.getByRole("button", { name: "跳过" });
  if (await skip.count()) await skip.click().catch(() => undefined);
  await page.waitForTimeout(3000);
  const articles = await page.locator("article").count();
  console.log(`[browse-cache] 补刷后卡片 ${articles} 张（上游可用时 >0）`);
  const missing2 = errors.filter((e) => e.includes("queryFn"));
  expect(missing2, `相关错误 ${missing2.length} 条`).toEqual([]);
});
