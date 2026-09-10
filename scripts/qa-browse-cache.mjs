/**
 * 浏览缓存回归。
 *
 * 作用：确认 localStorage 里的过期浏览缓存不会在非浏览页炸 "Missing queryFn"
 *      （hydrate 后台刷新只能打有观察者的键），且回到浏览页时会自动补刷。
 * 用法：node scripts/qa-browse-cache.mjs（dev server 先起在 127.0.0.1:8080）。
 * 为什么：localhost 和 127.0.0.1 是两个源，只有真正用过的那侧才有持久化缓存，
 *        这个错只在那一侧出现，必须在脚本里手工种出同样的现场。
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
/** @type {{ name: string, pass: boolean, detail: string }[]} */
const results = [];
/** @param {string} name @param {boolean} pass @param {string} detail */
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disk-cache-dir=.pw-cache"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
/** @type {string[]} */
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 220)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 220));
});

try {
  // 预置一条 2 小时前的 home-pixiv 日榜缓存：无下一页，能出数据只能靠"过期补刷"
  await page.addInitScript(() => {
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
    const state = {
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
    };
    localStorage.setItem("kami-browse-v1", JSON.stringify(state));
  });

  // 1) 带着过期缓存直接开非浏览页：不应再炸 Missing queryFn
  await page.goto(BASE + "/vault", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  const missing = errors.filter((e) => e.includes("queryFn"));
  record("非浏览页不炸 Missing queryFn", missing.length === 0, `相关错误 ${missing.length} 条`);

  // 2) 回到浏览页：旧列表先画，超时后自动补刷出真数据（种的数据没有下一页，出卡片只能靠补刷）
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const skip = page.getByRole("button", { name: "跳过" });
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(3000);
  const articles = await page.locator("article").count();
  record("回到浏览页自动补刷", articles > 0, `卡片 ${articles} 张`);
  const missing2 = errors.filter((e) => e.includes("queryFn"));
  record("全程无 Missing queryFn", missing2.length === 0, `相关错误 ${missing2.length} 条`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) process.exit(1);
