#!/usr/bin/env node
/**
 * e2e 专用 dev server 包装。
 *
 * 作用：把 KAMI_ROOT 指到仓库外的临时目录，并把 migrations/ 复制进去——
 *      db.ts 的迁移按 KAMI_ROOT 解析 migrations 目录，临时根没有它就会
 *      零表启动（better-auth SCHEMA_MISMATCH，访客闸上 500）。
 * 用法：playwright webServer 的 command 调本脚本（内部再经 with-app-env 起 next）。
 * 为什么放仓库外：resolveKamiRoot 的 walkUp 会从仓库内目录向上找到
 *        package.json 解析回真实根，只有仓库外目录才绕不开。
 * TD-26：固定 8090 专用端口（playwright.config.ts 同口径）——本地 8080 的
 *        普通 dev server 不再被 reuseExistingServer 误复用，测试数据隔离
 *        不依赖「8080 恰好没人占」。dev script 的 --port 写死 8080，所以
 *        这里绕过 npm 直接调 with-app-env + next CLI（env 包装语义不变）。
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8090;
const root = join(tmpdir(), "kami-e2e");
rmSync(join(root, "migrations"), { recursive: true, force: true });
mkdirSync(root, { recursive: true });
cpSync(join(process.cwd(), "migrations"), join(root, "migrations"), { recursive: true });
process.env.KAMI_ROOT = root;

const child = spawn(
  process.execPath,
  ["scripts/with-app-env.mjs", "next", "dev", "--hostname", "127.0.0.1", "--port", String(PORT)],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => process.exit(code ?? 0));
