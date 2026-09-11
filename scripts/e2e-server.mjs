#!/usr/bin/env node
/**
 * e2e 专用 dev server 包装。
 *
 * 作用：把 KAMI_ROOT 指到仓库外的临时目录，并把 migrations/ 复制进去——
 *      db.ts 的迁移按 KAMI_ROOT 解析 migrations 目录，临时根没有它就会
 *      零表启动（better-auth SCHEMA_MISMATCH，访客闸上 500）。
 * 用法：playwright webServer 的 command 调本脚本（内部再起 npm run dev）。
 * 为什么放仓库外：resolveKamiRoot 的 walkUp 会从仓库内目录向上找到
 *        package.json 解析回真实根，只有仓库外目录才绕不开。
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(tmpdir(), "kami-e2e");
rmSync(join(root, "migrations"), { recursive: true, force: true });
mkdirSync(root, { recursive: true });
cpSync(join(process.cwd(), "migrations"), join(root, "migrations"), { recursive: true });
process.env.KAMI_ROOT = root;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["run", "dev"], { stdio: "inherit", env: process.env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
