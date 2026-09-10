/**
 * 图站 403 修复 + hydration 修复验收。
 *
 * 作用：无头 Chrome 里确认 1) 首页无 hydration 警告（红色气泡的根源）
 *      2) Konachan 日 / 周 / 月榜在界面上能正常出卡片（走 konachan.net 兜底）。
 * 用法：node scripts/qa-booru-fix.mjs（dev server 先起在 127.0.0.1:8080）。
 * 为什么：403 兜底和水合修复都改了用户看得见的行为，要在真浏览器里过一遍。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
mkdirSync("screenshots", { recursive: true });

/** @type {string[]} */
const consoleMsgs = [];
/** @type {{ name: string, pass: boolean, detail: string }[]} */
const results = [];
/** @param {string} name @param {boolean} pass @param {string} detail */
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disk-cache-dir=.pw-cache"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => consoleMsgs.push("pageerror: " + String(e).slice(0, 200)));

try {
  // 1) 首页 hydration 检查（预置 tab=konachan：持久化值 ≠ 默认值时才最能暴露水合错位）
  await page.addInitScript(() => {
    localStorage.setItem(
      "kami-settings",
      JSON.stringify({ state: { tab: "konachan", onboarded: true }, version: 10 }),
    );
  });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const hydrationWarnings = consoleMsgs.filter(
    (m) => m.includes("hydrat") || m.includes("server rendered HTML"),
  );
  record("首页无 hydration 警告", hydrationWarnings.length === 0, `相关消息 ${hydrationWarnings.length} 条`);
  if (hydrationWarnings.length) console.log("  ", hydrationWarnings[0].slice(0, 200));

  // 2) 已在 Konachan 浏览页，逐榜检查（日榜用"今天"的日期，榜单没攒出数据属正常空态）
  for (const feed of ["日榜", "周榜", "月榜"]) {
    consoleMsgs.length = 0;
    await page.getByRole("radio", { name: feed }).click();
    await page.waitForTimeout(6000);
    const articles = await page.locator("article").count();
    const hasError = consoleMsgs.some((m) => m.includes("403"));
    const bodyText = (await page.locator("main").innerText()).slice(0, 400);
    const failed = bodyText.includes("403") || bodyText.includes("请求失败");
    const minCards = feed === "日榜" ? 0 : 1;
    record(
      `Konachan ${feed}`,
      articles >= minCards && !failed && !hasError,
      `卡片 ${articles} 张，报错=${failed || hasError}`,
    );
    if (feed === "日榜") await page.screenshot({ path: "screenshots/qa-booru-konachan-daily.png" });
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) process.exit(1);
