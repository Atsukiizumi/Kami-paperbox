/**
 * E2E 配置（M7）。
 *
 * 作用：把关键路径（浏览→详情→入队→纸匣）和浏览缓存回归纳入可重复执行的
 *      测试；CI 的 e2e job 跑同一套。
 * 用法：pnpm test:e2e（本地跑专用 8090 端口，与日常 dev 的 8080 互不相扰；
 *      CI 起新的）。
 * 为什么：qa-*.mjs 是一次性手动脚本，没有重试/报告/CI 接线；关键路径靠人点
 *        是会退化的。
 * 注意：spec 打真实上游（yande，无需登录）——上游抖动时 CI 可能红，先重试
 *      一次再人工判断。
 */
import { defineConfig } from "@playwright/test";

/** e2e 专用端口，须与 scripts/e2e-server.mjs 保持一致。 */
const E2E_BASE_URL = "http://127.0.0.1:8090";

export default defineConfig({
  testDir: "e2e",
  timeout: 300_000, // Next 16 dev 冷编译更慢，首屏用例留足余量
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: E2E_BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // 包装脚本把 KAMI_ROOT 指到仓库外临时目录并复制 migrations 进去
    // （迁移按 KAMI_ROOT 解析），e2e 的账号/快照/缓存不再碰真实 .data。
    // TD-26：专用 8090 端口——复用只可能命中同一个隔离的 e2e server，
    // 本地 8080 的普通 dev server 再也不会被误复用导致测试数据写进真实 .data。
    command: "node scripts/e2e-server.mjs",
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
