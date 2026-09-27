/**
 * 多设备同步场景（M3）：两个 browser context 同一应用账号。
 *
 * 断言：context A 注册 → 改可同步设置（「过滤 AI 作画」）→ 等 4s 防抖自动
 * 推送落库；context B（全新 context）同账号登录 → 拉取后设置与 A 一致。
 *
 * 全程只走设置页（不点任何会打 /api/source 的路径），对真实上游零依赖；
 * 注册 / 登录只经本机应用账号端点（better-auth + /api/account/sync，
 * e2e 专用 8090 + 仓库外临时根）。
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "kami-e2e-pass-123";

/** 应用账号表单提交（A 注册 / B 登录同一套表单）。 */
async function submitAppAccount(page: Page, email: string, action: "注册" | "登录") {
  const emailInput = page.locator("#app-account-email");
  await emailInput.waitFor({ state: "visible", timeout: 60_000 });
  // 账号开关形态 + 水合：表单就绪前是禁用的（critical-path 同款等待）
  await page.waitForFunction(
    () => {
      const input = document.querySelector("#app-account-email");
      return input instanceof HTMLInputElement && !input.disabled;
    },
    undefined,
    { timeout: 60_000, polling: 500 },
  );
  await emailInput.fill(email);
  await page.locator("#app-account-password").fill(PASSWORD);
  await page.getByRole("button", { name: action, exact: true }).click();
}

/** 浏览分区「过滤 AI 作画」开关（默认关；同分区还有 R-18 / 原图两个开关，按行文案定位）。 */
function aiFilterSwitch(page: Page) {
  return page
    .locator("div.flex.items-center.justify-between", { hasText: "过滤 AI 作画" })
    .getByRole("switch");
}

function seedOnboarded(version = 10): string {
  return `localStorage.setItem("kami-settings", JSON.stringify({ state: { onboarded: true, tab: "yande" }, version: ${version} }));`;
}

test("A 改设置自动推送，B 同账号登录拉取一致", async ({ page, browser }) => {
  const errors: string[] = [];
  const email = `kami-e2e-sync-${Date.now()}@example.com`;

  // ── Context A：注册 + 改设置 + 4s 防抖自动推送 ────────────────────────────
  await page.addInitScript(seedOnboarded());
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  await submitAppAccount(page, email, "注册");
  await expect(page.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/settings#browse");
  const aiSwitchA = aiFilterSwitch(page);
  await expect(aiSwitchA).toBeVisible({ timeout: 30_000 });
  await aiSwitchA.click();

  // 等过 4s 防抖：settings 段自动推送落库（POST 200 是推送完成的确定性信号）
  const pushDone = page.waitForResponse(
    (r) =>
      r.url().includes("/api/account/sync") &&
      r.request().method() === "POST" &&
      (r.request().postData() ?? "").includes('"segment":"settings"') &&
      r.status() === 200,
    { timeout: 20_000 },
  );
  await pushDone;

  // ── Context B：同账号登录 → 拉取 → 设置一致 ──────────────────────────────
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await pageB.addInitScript(seedOnboarded());

  await pageB.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  await submitAppAccount(pageB, email, "登录");
  await expect(pageB.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });

  // 登录瞬间的自动拉取可能与 KEK 派生竞态（密码派生 KEK 落 sessionStorage 稍晚
  // 于 bridge 首拉，密文段会被跳过一次）——显式点「从服务端恢复」强制拉取，
  // 走的是同一条 pullAccountSync 通道，确定性不牺牲覆盖面。
  const restore = pageB.getByRole("button", { name: "从服务端恢复" });
  await expect(restore).toBeVisible({ timeout: 15_000 });
  await restore.click();

  await pageB.goto("/settings#browse");
  await expect(aiFilterSwitch(pageB)).toHaveAttribute("data-state", "checked", { timeout: 30_000 });

  // 存储层复核：持久化的 settings 段确实带着 A 的改动
  const hideAi = await pageB.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("kami-settings") ?? "{}") as { state?: { hideAi?: boolean } };
    return raw.state?.hideAi;
  });
  expect(hideAi).toBe(true);

  await contextB.close();
  expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
});

/** 读持久化设置段里的合集（collections v15 起随设置段同步）。 */
function readCollections(page: Page) {
  return page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("kami-settings") ?? "{}") as {
      state?: { collections?: Array<Record<string, unknown>> };
    };
    return raw.state?.collections ?? null;
  });
}

test("A 建合集自动推送，B 拉取一致（collections 随设置段同步）", async ({ page, browser }) => {
  const errors: string[] = [];
  const email = `kami-e2e-collections-${Date.now()}@example.com`;
  const COLLECTION_NAME = "e2e 合集";

  // ── Context A：注册 → 纸匣页「新建合集」（window.prompt 命名）→ 4s 防抖推送 ──
  await page.addInitScript(seedOnboarded(15));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  await submitAppAccount(page, email, "注册");
  await expect(page.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });
  // 登录后的 5s 静默窗会丢弃窗内到点的防抖推送（bridge 到点判窗直接 return 不补推）。
  // CI 上 /vault 已被前序用例编译热身，注册→建合集只隔 ~1s，4s 防抖正好落窗内被丢
  // （本地冷编译慢反而躲开）——等出窗口再操作，消除竞态。
  await page.waitForTimeout(5_500);

  await page.goto("/vault", { waitUntil: "domcontentloaded" });
  const createBtn = page.getByRole("button", { name: "新建合集" });
  await expect(createBtn).toBeVisible({ timeout: 30_000 });
  // 临时诊断（CI 专用，定位后删除）：记录窗口内所有 sync 请求与本地合集态
  const syncLog: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/account/sync")) {
      syncLog.push(`>${r.method()} seg=${(r.postData() ?? "").slice(0, 80)}`);
    }
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/account/sync")) {
      syncLog.push(`<${r.request().method()} ${r.status()}`);
    }
  });
  // 新建合集走 window.prompt（与「存为智能文件夹」同一交互）：dialog 事件应答
  const promptAnswered = page.waitForEvent("dialog").then((d) => d.accept(COLLECTION_NAME));
  const pushDone = page.waitForResponse(
    (r) => {
      const body = r.request().postData() ?? "";
      // 注册后 settings 段是 KEK 密文推送，载荷里不会有明文合集名——
      // 这里只等段级 POST 200；内容一致性由两侧 readCollections 断言（下方）。
      return (
        r.url().includes("/api/account/sync") &&
        r.request().method() === "POST" &&
        body.includes('"segment":"settings"') &&
        r.status() === 200
      );
    },
    { timeout: 60_000 },
  );
  await createBtn.click();
  await promptAnswered;
  // 合集先落进本地设置段（同步推送的源头），再等 4s 防抖后的 settings 段 POST 200
  await expect
    .poll(() => readCollections(page), { timeout: 15_000 })
    .toEqual([expect.objectContaining({ name: COLLECTION_NAME })]);
  const pushResult = await pushDone.then(
    () => "ok",
    () => "timeout",
  );
  if (pushResult !== "ok") {
    console.log(`[diag] url=${page.url()} syncLog(${syncLog.length})=\n${syncLog.join("\n")}`);
    const raw = await readCollections(page);
    console.log(`[diag] collections=${JSON.stringify(raw)}`);
    throw new Error("settings push 未在 60s 内出现（诊断信息见上方 [diag]）");
  }
  const aCollections = await readCollections(page);
  expect(aCollections).toEqual([expect.objectContaining({ name: COLLECTION_NAME })]);

  // ── Context B：同账号登录 → 显式「从服务端恢复」→ collections 与 A 一致 ────
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await pageB.addInitScript(seedOnboarded(15));

  await pageB.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  await submitAppAccount(pageB, email, "登录");
  await expect(pageB.getByText("已登录").first()).toBeVisible({ timeout: 30_000 });

  // 登录瞬间的自动拉取可能与 KEK 派生竞态（同上一条 spec 的绕法）：
  // 显式点「从服务端恢复」强制走同一条 pullAccountSync 通道
  const restore = pageB.getByRole("button", { name: "从服务端恢复" });
  await expect(restore).toBeVisible({ timeout: 15_000 });
  await restore.click();

  // 存储层复核：B 持久化的 settings 段带着 A 建的合集（形状逐字段一致）
  await expect.poll(() => readCollections(pageB), { timeout: 30_000 }).toEqual(aCollections);

  await contextB.close();
  expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
});
