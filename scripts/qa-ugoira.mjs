/**
 * 动图播放无头验收。
 *
 * 作用：真实 Chromium 里走一遍 GIF / Ugoira 播放链路（卡片、悬停预览、详情页）。
 * 用法：node scripts/qa-ugoira.mjs（dev server 要先起在 127.0.0.1:8080）。
 * 为什么：内嵌浏览器面板会节流后台定时器，播放是否流畅只有在真浏览器里才作数。
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const SHOT_DIR = "screenshots";
mkdirSync(SHOT_DIR, { recursive: true });

const consoleErrors = [];
const requestFails = [];
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

// 页内采样：对每个匹配元素截两张图，字节级比较。
// 为什么用截图而不是 canvas 像素哈希：眨眼类动图只有局部小变化，降采样会把变化抹掉。
// 返回每个 canvas 所属作品 id（有卡片上下文时），详情页步骤会挑一个已验证能播的。
async function animatingCards(page, windowMs) {
  const infos = await page.evaluate(() =>
    [...document.querySelectorAll("article canvas")].map((cv) => {
      const a = cv.closest("article")?.querySelector('a[href*="/work/pixiv/"]');
      return a?.getAttribute("href") || "";
    }),
  );
  const handles = await page.$$("article canvas");
  let changed = 0;
  const playableIds = [];
  for (let i = 0; i < handles.length; i += 1) {
    const a = await handles[i].screenshot().catch(() => null);
    await page.waitForTimeout(windowMs);
    const b = await handles[i].screenshot().catch(() => null);
    if (a && b && !a.equals(b)) {
      changed += 1;
      if (infos[i]) playableIds.push(infos[i]);
    }
  }
  return { total: handles.length, changed, playableIds };
}

async function animatingCount(page, selector, windowMs) {
  const handles = await page.$$(selector);
  let changed = 0;
  for (const h of handles) {
    const a = await h.screenshot().catch(() => null);
    await page.waitForTimeout(windowMs);
    const b = await h.screenshot().catch(() => null);
    if (a && b && !a.equals(b)) changed += 1;
  }
  return { total: handles.length, changed };
}

// disk-cache-dir：无头 Chromium 默认临时目录写缓存会失败（ERR_CACHE_WRITE_FAILURE），
// 大 zip（数 MB、cacheable）直接被中断；指到项目里的目录就正常。
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disk-cache-dir=.pw-cache"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err).slice(0, 200)));
page.on("requestfailed", (r) => requestFails.push(r.url().slice(0, 140) + " :: " + (r.failure()?.errorText || "")));

async function dismissDialogs() {
  for (const label of ["跳过", "稍后再说", "关闭"]) {
    const btn = page.getByRole("button", { name: label, exact: true });
    if (await btn.count()) {
      await btn.first().click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await dismissDialogs();

  // 定时器基线：确认这个环境没有节流（90ms 链实际应 ≈90ms）
  const timerBase = await page.evaluate(async () => {
    const t0 = performance.now();
    const stamps = [];
    await new Promise((done) => {
      let i = 0;
      const step = () => {
        stamps.push(Math.round(performance.now() - t0));
        if (++i >= 6) return done();
        setTimeout(step, 90);
      };
      setTimeout(step, 90);
    });
    return stamps[stamps.length - 1];
  });
  record("定时器基线", timerBase < 1200, `6×90ms 链实际耗时 ${timerBase}ms`);

  // 搜索 うごイラ（先出建议，再 Enter 确认）
  const box = page.getByPlaceholder("多个标签用空格分开，或粘贴作品 / 画师链接");
  await box.click();
  await box.type("うごイラ");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);

  const gifBadges = await page.getByText("GIF", { exact: true }).count();
  record("搜索结果含动图卡片", gifBadges > 0, `GIF 徽标 ${gifBadges} 个`);

  // 等卡片上的动图 canvas 出现（元数据 + zip 下载完成；冷缓存要过服务端节流队列）
  await page.waitForSelector("article canvas", { timeout: 20000 });
  await page.waitForTimeout(7000);

  const cards = await animatingCards(page, 800);
  record("卡片封面在播", cards.changed >= 1, `${cards.changed}/${cards.total} 个 canvas 帧在推进`);

  await page.screenshot({ path: `${SHOT_DIR}/qa-ugoira-grid.png` });

  // 悬停第一张动图卡 → 悬停预览里应有自己的播放器（portal 挂在 body 上）
  const firstGifCard = page.locator("article", { hasText: "GIF" }).first();
  await firstGifCard.hover();
  await page.waitForTimeout(1800);
  const preview = await animatingCount(page, "body > div canvas", 1200);
  await page.screenshot({ path: `${SHOT_DIR}/qa-ugoira-hover.png` });
  record("悬停预览", preview.changed > 0, `body 层 canvas ${preview.total} 个，${preview.changed} 个在动`);

  // 详情页：优先用卡片阶段已验证能播的作品（本机无头环境对大 zip 有缓存写入故障），
  // 退而求其次用第一张动图卡。
  await page.mouse.move(8, 8);
  await page.waitForTimeout(600);
  await dismissDialogs();
  const detailUrl =
    cards.playableIds[0] ??
    (await firstGifCard.locator('a[href*="/work/pixiv/"]').first().getAttribute("href"));
  await page.goto(BASE + detailUrl, { waitUntil: "domcontentloaded" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settled = await page
      .waitForFunction(
        () => Boolean(document.querySelector("article canvas")) || document.body.innerText.includes("Failed to fetch"),
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (settled && (await page.locator("article canvas").count()) > 0) break;
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(6000);
  await page.waitForTimeout(6000);
  const detail = await animatingCount(page, "article canvas", 900);
  await page.screenshot({ path: `${SHOT_DIR}/qa-ugoira-detail.png` });
  record("详情页播放", detail.changed > 0, `详情 canvas ${detail.total} 个，${detail.changed} 个在动`);
  if (detail.changed === 0 && requestFails.length) {
    console.log("detail 阶段失败请求：", requestFails.slice(-6));
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
// 已知的非阻断噪声：无头 Chromium 缓存写失败（环境）、Next 迁移遗留的 hydration 属性警告
const realErrors = consoleErrors.filter(
  (e) =>
    !e.includes("ERR_CACHE_WRITE_FAILURE") &&
    !e.includes("favicon") &&
    !e.includes("server rendered HTML didn't match"),
);
writeFileSync(
  `${SHOT_DIR}/qa-ugoira-report.json`,
  JSON.stringify({ results, consoleErrors }, null, 2),
);
console.log(`\n${results.length - failed.length}/${results.length} 项通过；控制台错误 ${consoleErrors.length} 条`);
if (failed.length || realErrors.length) {
  if (realErrors.length) console.log("console:", realErrors.slice(0, 8));
  process.exit(1);
}
