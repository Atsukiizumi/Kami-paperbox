/**
 * 依赖更新时的安全检查：生产依赖审计，加上 Docker / CI 的 Node 钉扎。
 *
 * 用法：pnpm security
 * 钉扎落后时退出码 1，并写明要改的 tag。nodejs.org 不可达也失败——
 * 静默跳过会让旧基础镜像一直留在 Dockerfile 里。
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectRootFrom } from "./kami-config.mjs";
import { checkNodePin, latestNode24 } from "./node-image-pin.mjs";

const ROOT = projectRootFrom(import.meta.url);
const INDEX_URL = "https://nodejs.org/dist/index.json";

function readWorkflows() {
  const dir = join(ROOT, ".github", "workflows");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

async function latestNode24FromIndex() {
  const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`nodejs.org 返回 ${response.status}`);
  const index = await response.json();
  const latest = latestNode24(index);
  if (!latest) throw new Error("nodejs.org 的索引里没有 Node 24 稳定版");
  return latest;
}

function auditProd() {
  return new Promise((resolve) => {
    // Windows 上直接 spawn pnpm.cmd 会 EINVAL（路径含空格时更是如此）。
    // 命令是固定字符串，不拼接外部输入。
    const child = spawn("pnpm audit --prod", {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const pin = checkNodePin({
  dockerfile: readFileSync(join(ROOT, "Dockerfile"), "utf8"),
  workflows: readWorkflows(),
  latest: await latestNode24FromIndex(),
});

if (pin.ok) {
  console.log(`[security] Node 镜像与 CI 钉在 ${pin.version}-bookworm-slim`);
} else {
  for (const error of pin.errors) console.error(`[security] ${error}`);
}

const auditCode = await auditProd();
if (!pin.ok || auditCode !== 0) process.exit(1);
