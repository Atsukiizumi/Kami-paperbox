/**
 * 出站代理。
 *
 * 作用：决定当前用哪条代理（设置里保存的 > kami.config.json > 环境变量）。
 * 用法：getActiveProxy()；设置页「保存代理」会写 .data/proxy.json。
 * 为什么：源站在国内常要代理；登录中转的 Chrome 也要走同一条，否则 Cookie 域对不上。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyUrl } from "./proxy-url.ts";

export type ProxySource = "saved" | "config" | "env" | "none";

export type ProxyState = {
  url: string;
  source: ProxySource;
};

const RUNTIME_REL = join(".data", "proxy.json");
const CONFIG_REL = "kami.config.json";

function runtimePath(root: string): string {
  return join(root, RUNTIME_REL);
}

function configPath(root: string): string {
  return join(root, CONFIG_REL);
}

function isKamiRoot(dir: string): boolean {
  if (existsSync(join(dir, "kami.config.example.json"))) return true;
  if (existsSync(join(dir, "kami.config.json"))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
    return pkg.name === "kami-paperbox";
  } catch {
    return false;
  }
}

function walkUp(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (isKamiRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve the project root even when Vite SSR cwd is not the repo. */
export function resolveKamiRoot(explicit?: string): string {
  if (explicit) return walkUp(explicit) ?? explicit;
  const env = process.env.KAMI_ROOT?.trim();
  if (env) return walkUp(env) ?? env;
  const fromCwd = walkUp(process.cwd());
  if (fromCwd) return fromCwd;
  try {
    const fromModule = walkUp(dirname(fileURLToPath(import.meta.url)));
    if (fromModule) return fromModule;
  } catch {
    /* bundled / virtual */
  }
  return process.cwd();
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  } catch {
    /* missing or unreadable */
  }
  return null;
}

function fromEnv(name: string): string {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function parseOrEmpty(raw: string): string {
  const parsed = parseProxyUrl(raw);
  return parsed.ok ? parsed.href : "";
}

function applyEnv(url: string) {
  if (url) process.env.KAMI_PROXY = url;
  else delete process.env.KAMI_PROXY;
}

function writeKamiConfigProxy(url: string, root: string) {
  const path = configPath(root);
  const current = readJsonFile(path) ?? {};
  const host = typeof current.host === "string" && current.host.trim() ? current.host.trim() : "0.0.0.0";
  const port = typeof current.port === "number" && Number.isInteger(current.port) ? current.port : 8080;
  const next = { ...current, host, port, proxy: url };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function readProxyState(root = resolveKamiRoot()): ProxyState {
  const saved = readJsonFile(runtimePath(root));
  if (saved && saved.set === true) {
    return { url: parseOrEmpty(typeof saved.url === "string" ? saved.url : ""), source: "saved" };
  }
  const cfg = readJsonFile(configPath(root));
  const fromCfg = parseOrEmpty(typeof cfg?.proxy === "string" ? cfg.proxy : "");
  if (fromCfg) return { url: fromCfg, source: "config" };
  const fromEnvVar =
    parseOrEmpty(fromEnv("KAMI_PROXY")) ||
    parseOrEmpty(fromEnv("ALL_PROXY")) ||
    parseOrEmpty(fromEnv("HTTPS_PROXY")) ||
    parseOrEmpty(fromEnv("HTTP_PROXY")) ||
    parseOrEmpty(fromEnv("https_proxy")) ||
    parseOrEmpty(fromEnv("http_proxy")) ||
    parseOrEmpty(fromEnv("all_proxy"));
  if (fromEnvVar) return { url: fromEnvVar, source: "env" };
  return { url: "", source: "none" };
}

export function getActiveProxy(root = resolveKamiRoot()): string {
  return readProxyState(root).url;
}

export function saveProxyUrl(raw: string, root = resolveKamiRoot()): ProxyState {
  const parsed = parseProxyUrl(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const path = runtimePath(root);
  const errors: string[] = [];
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ set: true, url: parsed.href }, null, 2)}\n`, "utf8");
  } catch (err) {
    errors.push(`.data/proxy.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    writeKamiConfigProxy(parsed.href, root);
  } catch (err) {
    errors.push(`kami.config.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  applyEnv(parsed.href);
  if (errors.length === 2) {
    throw new Error(`代理没能写进磁盘：${errors.join("；")}`);
  }
  if (errors.length) {
    console.warn(`[kami] 代理部分写入失败：${errors.join("；")}`);
  } else {
    console.info(`[kami] 代理已写入 ${configPath(root)}`);
  }
  return { url: parsed.href, source: parsed.href ? "saved" : "none" };
}

export function clearSavedProxy(root = resolveKamiRoot()): ProxyState {
  try {
    unlinkSync(runtimePath(root));
  } catch {
    /* already gone */
  }
  try {
    writeKamiConfigProxy("", root);
  } catch {
    /* config may be missing in a fresh tree */
  }
  applyEnv("");
  return readProxyState(root);
}
