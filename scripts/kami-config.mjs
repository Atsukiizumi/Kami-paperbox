#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const KAMI_CONFIG_NAME = "kami.config.json";
export const KAMI_CONFIG_EXAMPLE = "kami.config.example.json";
export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_PORT = 8080;

export function projectRootFrom(moduleUrl = import.meta.url) {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/** Clone the example config when the local file is missing. Never overwrites. */
export function ensureKamiConfig(root) {
  const dest = join(root, KAMI_CONFIG_NAME);
  if (existsSync(dest)) return dest;
  const example = join(root, KAMI_CONFIG_EXAMPLE);
  if (!existsSync(example)) return dest;
  copyFileSync(example, dest);
  return dest;
}

export function readKamiConfig(root) {
  const defaults = { host: DEFAULT_HOST, port: DEFAULT_PORT, proxy: "" };
  const file = join(root, KAMI_CONFIG_NAME);
  if (!existsSync(file)) return defaults;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const host =
      typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : defaults.host;
    const port = Number(raw.port);
    return {
      host,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : defaults.port,
      proxy: typeof raw.proxy === "string" ? raw.proxy.trim() : "",
    };
  } catch {
    return defaults;
  }
}

export function applyKamiEnv(env, root) {
  const cfg = readKamiConfig(root);
  const next = { ...env };
  if (!next.HOST) next.HOST = cfg.host;
  if (!next.PORT) next.PORT = String(cfg.port);
  if (!next.NITRO_HOST) next.NITRO_HOST = cfg.host;
  if (!next.NITRO_PORT) next.NITRO_PORT = String(cfg.port);
  if (cfg.proxy && !next.KAMI_PROXY) next.KAMI_PROXY = cfg.proxy;
  return next;
}
