#!/usr/bin/env node
/**
 * 一条命令跑纸匣。优先 pnpm，没有就用 npm。
 *
 *   pnpm i && pnpm dev
 *   node scripts/kami.mjs          # 等同 pnpm dev，缺依赖会先装
 *   node scripts/kami.mjs build
 *   node scripts/kami.mjs start
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureKamiConfig } from "./kami-config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
ensureKamiConfig(root);
const task = process.argv[2] || "dev";
const extra = process.argv.slice(3);

function which(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf8" });
  return r.status === 0;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

function installer() {
  if (which("pnpm")) return ["pnpm", ["install"]];
  if (which("npm")) return ["npm", ["install"]];
  console.error("需要 Node.js 22+，并安装 pnpm（推荐）或 npm。");
  console.error("  npm i -g pnpm");
  process.exit(1);
}

function runner() {
  if (which("pnpm")) return ["pnpm", []];
  return ["npm", ["run"]];
}

const vite = join(root, "node_modules", "vite");
if (!existsSync(vite)) {
  const [cmd, args] = installer();
  console.log(`未检测到依赖，正在 ${cmd} ${args.join(" ")} …`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status) process.exit(r.status);
}

const known = new Set(["dev", "build", "start", "test", "typecheck", "pack", "preview"]);
if (!known.has(task)) {
  console.error(`用法: pnpm ${task === "help" ? "dev" : "<dev|build|start|pack>"}`);
  console.error("  pnpm i       安装依赖");
  console.error("  pnpm dev     开发（http://localhost:8080）");
  console.error("  pnpm build   生产构建");
  console.error("  pnpm start   启动生产服务");
  console.error("  pnpm pack    打包源码 tar");
  process.exit(task === "help" ? 0 : 2);
}

const [cmd, prefix] = runner();
run(cmd, [...prefix, task, ...extra]);
