/**
 * 登录中转 401 快速失败（#114 回归锁，M3）。
 *
 * 断言：打开登录中转后 start 请求吃到非 2xx 时——
 *   1) 对话框立即渲染错误提示（修复前卡「正在打开」+ 脚注「已结束」）；
 *   2) 轮询不启动 / 终止：/api/login-browser 请求数有上限（280ms 轮询若不
 *      退出，1.5s 窗口内会堆积 5+ 次；快速失败应只有 start 一次）。
 *
 * 用 Playwright route 拦截回 401 而不是吃真实访客响应：数据面对登录中转
 * 显式放行访客（TD-20 内容面口径），真实路径会去拉起后端 Chrome——e2e 环境
 * 既不可靠也不必要；401 是快速失败分支的确定性输入。
 */
import { expect, test } from "@playwright/test";

/** session-relay.tsx 的 loginGateError(401) 文案前缀。 */
const LOGIN_GATE_ERROR = "需要先登录应用账号";

test("访客打开登录中转：非 2xx 立即报错且轮询终止", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  let loginBrowserRequests = 0;
  await page.route("**/api/login-browser*", (route) => {
    loginBrowserRequests += 1;
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
  });

  // 访客态（新 context 无会话），跳过新手引导直达设置的登录中转入口
  await page.addInitScript(() => {
    localStorage.setItem(
      "kami-settings",
      JSON.stringify({ state: { onboarded: true, tab: "yande" }, version: 10 }),
    );
  });

  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  const loginPixiv = page.getByRole("button", { name: "登录 Pixiv" }).first();
  await expect(loginPixiv).toBeVisible({ timeout: 60_000 }); // dev 冷编译留余量
  await loginPixiv.click();

  // 错误提示出现（快速失败，不卡「正在打开」）
  await expect(page.getByText(LOGIN_GATE_ERROR).first()).toBeVisible({ timeout: 15_000 });

  // 轮询终止：错误出现后再等过多个轮询周期（280ms/次），请求数必须停在 1
  await page.waitForTimeout(1_500);
  expect(loginBrowserRequests).toBe(1);

  expect(errors, `页面错误：${errors.join(" | ")}`).toEqual([]);
});
