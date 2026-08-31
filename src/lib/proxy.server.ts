import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseProxyUrl } from "./proxy-url";

export type ProxySource = "saved" | "config" | "env" | "none";

export type ProxyState = {
  url: string;
  source: ProxySource;
};

const RUNTIME_REL = join(".data", "proxy.json");

function runtimePath(): string {
  return join(process.cwd(), RUNTIME_REL);
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

export function readProxyState(): ProxyState {
  const saved = readJsonFile(runtimePath());
  if (saved && saved.set === true) {
    return { url: parseOrEmpty(typeof saved.url === "string" ? saved.url : ""), source: "saved" };
  }
  const cfg = readJsonFile(join(process.cwd(), "kami.config.json"));
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

export function getActiveProxy(): string {
  return readProxyState().url;
}

export function saveProxyUrl(raw: string): ProxyState {
  const parsed = parseProxyUrl(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const path = runtimePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ set: true, url: parsed.href }, null, 2)}\n`, "utf8");
  return { url: parsed.href, source: "saved" };
}

export function clearSavedProxy(): ProxyState {
  try {
    unlinkSync(runtimePath());
  } catch {
    /* already gone */
  }
  return readProxyState();
}
