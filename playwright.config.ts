/**
 * E2E 配置（M7）。
 *
 * 作用：把关键路径（浏览→详情→入队→纸匣）和浏览缓存回归纳入可重复执行的
 *      测试；CI 的 e2e job 跑同一套。
 * 用法：pnpm test:e2e（本地会复用已在 8080 起的 dev server；CI 起新的）。
 * 为什么：qa-*.mjs 是一次性手动脚本，没有重试/报告/CI 接线；关键路径靠人点
 *        是会退化的。
 * 注意：spec 打真实上游（yande，无需登录）——上游抖动时 CI 可能红，先重试
 *      一次再人工判断。
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8080",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
