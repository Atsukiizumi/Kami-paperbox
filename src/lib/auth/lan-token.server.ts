/**
 * 局域网配对令牌 —— 服务端（落盘 / 校验 / 终端打印）。
 *
 * 从 data-plane.server 拆出：这条依赖链（proxy.server → lan-pairing）可以
 * 直接进 node --test，不必拉起 Better Auth。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { resolveKamiRoot } from "../proxy.server.ts";
import { LAN_TOKEN_COOKIE, isValidLanTokenShape } from "../sync/lan-pairing.ts";

const LAN_TOKEN_BYTES = 24;

let cachedToken: string | null = null;

function tokenPath(): string {
  return join(resolveKamiRoot(), ".data", "lan-token.json");
}

/** 启动令牌：首次生成落盘，之后复用；换新 = 删文件重启（所有浏览器重新配对）。 */
export function readLanToken(): string {
  if (cachedToken) return cachedToken;
  const file = tokenPath();
  try {
    if (existsSync(file)) {
      const rec = JSON.parse(readFileSync(file, "utf8")) as { token?: unknown };
      if (typeof rec.token === "string" && isValidLanTokenShape(rec.token)) {
        cachedToken = rec.token;
        return cachedToken;
      }
    }
  } catch {
    /* 损坏就重建 */
  }
  const token = randomBytes(LAN_TOKEN_BYTES).toString("base64url");
  try {
    mkdirSync(join(resolveKamiRoot(), ".data"), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    /* 只读根目录：进程内兜底，本进程仍受保护 */
  }
  cachedToken = token;
  return token;
}

/** 从请求取令牌：Authorization 头 / ?token= / 配对 cookie（<img> 只能靠 cookie）。 */
export function lanTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header && /^bearer\s+/i.test(header)) {
    const token = header.replace(/^bearer\s+/i, "").trim();
    if (token) return token;
  }
  const query = new URL(request.url).searchParams.get("token");
  if (query) return query;
  const cookie = request.headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === LAN_TOKEN_COOKIE) {
        try {
          return decodeURIComponent(rest.join("=")) || null;
        } catch {
          return rest.join("=") || null;
        }
      }
    }
  }
  return null;
}

/** 先哈希到定长再 timingSafeEqual，避免长度与时序泄漏。 */
export function lanTokenMatches(provided: string, expected: string): boolean {
  if (!isValidLanTokenShape(provided) || !isValidLanTokenShape(expected)) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

let printed = false;

/**
 * 首次生成或首次被数据面闸读到时打印配对指引（每进程一次）。
 * 不用 Next 的 instrumentation 钩子 —— 它的 bundle 不认 node: scheme，
 * 而这里 crypto/fs 是必须的。浏览器一打开就会触发首个 API 请求，
 * 时机上等同启动打印。
 */
export function printLanPairingIntroOnce(): void {
  if (printed) return;
  printed = true;
  const token = readLanToken();
  const port = process.env.PORT ?? "8080";
  console.log(`[kami] 局域网访问令牌（新设备首次打开需配对）：${token}`);
  for (const host of lanHosts()) {
    console.log(`[kami] 配对入口：http://${host}:${port}/#pair=${token}`);
  }
  console.log("[kami] 令牌存于 .data/lan-token.json；如泄露，删除该文件并重启即可换新。");
}

function lanHosts(): string[] {
  const hosts = ["127.0.0.1"];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === "IPv4" && !net.internal) hosts.push(net.address);
      }
    }
  } catch {
    /* 拿不到网卡信息就只打本机 */
  }
  return hosts;
}
