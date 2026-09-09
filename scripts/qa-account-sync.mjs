/**
 * 应用账号同步验收。
 *
 * 作用：无头 Chrome 里走完整链路——注册 → 改设置自动推送 → 全新浏览器登录 →
 *      设置自动恢复。
 * 用法：node scripts/qa-account-sync.mjs（dev server 先起在 127.0.0.1:8080）。
 * 为什么：换浏览器不丢数据是这个功能的核心承诺，必须用两个干净浏览器验证。
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const EMAIL = `kami-qa-${Date.now()}@example.com`;
const PASSWORD = "kami-pass-123";
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function dismissDialogs(page) {
  for (let i = 0; i < 3; i += 1) {
    const overlay = page.locator('div[data-state="open"][data-aria-hidden="true"]');
    if (!(await overlay.count())) return;
    for (const label of ["跳过", "稍后再说", "关闭"]) {
      const btn = page.getByRole("button", { name: label, exact: true });
      if (await btn.count()) {
        await btn.first().click({ timeout: 1500, force: true }).catch(() => {});
        break;
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }
}

// ── 浏览器 A：注册并登录 ─────────────────────────────────────────────
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disk-cache-dir=.pw-cache"] });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// 预置 onboarded：新手引导关掉后会跳去首页，把设置页卸了（与账号同步无关）
await ctxA.addInitScript(() => {
  localStorage.setItem("kami-settings", JSON.stringify({ state: { onboarded: true }, version: 10 }));
});
const pageA = await ctxA.newPage();
const errorsA = [];
pageA.on("pageerror", (e) => errorsA.push(String(e).slice(0, 150)));

try {
  await pageA.goto(`${BASE}/settings#accounts`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageA.locator("#app-account-email").waitFor({ state: "visible", timeout: 60000 });
  // 水合后表单可能先换成「正在读取登录状态…」再换回来，等它稳定
  await pageA.waitForFunction(() => {
    const input = document.querySelector("#app-account-email");
    return input instanceof HTMLInputElement && !input.disabled;
  }, { timeout: 60000, polling: 500 });
  await dismissDialogs(pageA);

  try {
    await pageA.locator("#app-account-email").fill(EMAIL, { timeout: 30000 });
  } catch {
    const info = await pageA.evaluate(() => {
      const el = document.querySelector("#app-account-email");
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { exists: true, rect: [r.x, r.y, r.width, r.height], display: cs.display, visibility: cs.visibility, disabled: el.disabled };
    });
    console.log("fill 失败现场：", JSON.stringify(info));
    console.log("main 开头：", await pageA.locator("main").innerText().catch(() => "<无>").then((t) => t.slice(0, 150)));
    await pageA.screenshot({ path: "screenshots/qa-account-fail.png" }).catch(() => {});
    throw new Error("email fill 失败");
  }
  await pageA.locator("#app-account-password").fill(PASSWORD);
  await pageA.getByRole("button", { name: "注册", exact: true }).click({ timeout: 10000 });
  await pageA.waitForTimeout(4000);
  const signedInA = await pageA.getByText("已登录").count();
  record("注册并登录", signedInA > 0, `email=${EMAIL}`);

  // 改一个会同步的设置：浏览页打开「过滤 AI」→ store 变化 → 防抖推送
  await pageA.goto(`${BASE}/settings#browse`, { waitUntil: "domcontentloaded" });
  await pageA.waitForTimeout(1500);
  const aiSwitch = pageA.locator('button[role="switch"]').first();
  await aiSwitch.click();
  await pageA.waitForTimeout(7000); // 防抖 4s + 网络

  // 在浏览器里直接问服务端：payload 存在，且开关相对默认值（safeMode=true / hideAi=false）有变化
  const remote = await pageA.evaluate(async () => {
    const r = await fetch("/api/account/sync", { cache: "no-store" });
    return r.json();
  });
  const s = remote?.payload?.settings;
  const pushed = Boolean(remote?.payload) && (s?.safeMode === false || s?.hideAi === true);
  record("设置变更自动推送到服务端", pushed, `服务端 safeMode=${s?.safeMode} hideAi=${s?.hideAi}`);
} finally {
  await ctxA.close();
}

// ── 浏览器 B：全新环境（无 localStorage、无 Cookie）登录同一账号 ────
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// 新浏览器也没有新手引导（模拟「换浏览器」时只关注账号同步本身）
await ctxB.addInitScript(() => {
  localStorage.setItem("kami-settings", JSON.stringify({ state: { onboarded: true }, version: 10 }));
});
const pageB = await ctxB.newPage();
try {
  await pageB.goto(`${BASE}/settings#accounts`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.locator("#app-account-email").waitFor({ state: "visible", timeout: 60000 });
  await pageB.waitForFunction(() => {
    const input = document.querySelector("#app-account-email");
    return input instanceof HTMLInputElement && !input.disabled;
  }, { timeout: 60000, polling: 500 });
  await dismissDialogs(pageB);

  await pageB.locator("#app-account-email").fill(EMAIL, { timeout: 30000 });
  await pageB.locator("#app-account-password").fill(PASSWORD);
  try {
    await pageB.getByRole("button", { name: "登录", exact: true }).click({ timeout: 15000 });
  } catch {
    const btns = await pageB.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => `[${b.textContent.trim().slice(0, 12)}]`)
        .join(""),
    );
    console.log("B 登录按钮缺失现场 url:", pageB.url(), "| 可见按钮:", btns.slice(0, 200));
    await pageB.screenshot({ path: "screenshots/qa-account-fail-b.png" }).catch(() => {});
    throw new Error("登录按钮缺失");
  }
  await pageB.waitForTimeout(6000); // 登录 → 桥接拉取 → applyBackup

  const signedInB = await pageB.getByText("已登录").count();
  record("新浏览器登录", signedInB > 0, "");

  const localSettings = await pageB.evaluate(() => localStorage.getItem("kami-settings") || "");
  const restored = localSettings.includes('"safeMode":false') || localSettings.includes('"hideAi":true');
  record("设置自动恢复", restored, `kami-settings 含恢复数据=${localSettings.length > 100}`);
} finally {
  await ctxB.close();
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length || errorsA.length) {
  if (errorsA.length) console.log("pageerrors:", errorsA.slice(0, 3));
  process.exit(1);
}
