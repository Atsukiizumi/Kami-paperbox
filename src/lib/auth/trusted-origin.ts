/**
 * Better Auth 的可信 Origin。
 *
 * 局域网用 IP、localhost、无点的机器名或 .local 打开时，Origin 就是这个
 * Host，应当放行。公网域名不按 Host 回声：恶意域名解析到本机时，Host 与
 * Origin 会一起变成那个域名（SEC-13）。显式 BETTER_AUTH_URL 仍整段放行。
 */
import { isIP } from "node:net";

export const LOCAL_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
] as const;

/** Host 头可以回声成 Origin 的主机名：字面 IP、本机、mDNS、无点的局域网名。 */
export function isReflectableHostname(hostname: string): boolean {
  const name = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!name || name.includes("%")) return false;
  if (isIP(name) !== 0) return true;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name.endsWith(".local")) return true;
  return !name.includes(".");
}

/** 把一个可回声的 Host 头变成 http 与 https 两个 Origin；公网域名返回空。 */
export function reflectableHostOrigins(hostHeader: string | null | undefined): string[] {
  if (!hostHeader) return [];
  const trimmed = hostHeader.trim();
  if (!trimmed || /[\s/\\]/.test(trimmed)) return [];
  let url: URL;
  try {
    url = new URL(`http://${trimmed}`);
  } catch {
    return [];
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return [];
  if (!isReflectableHostname(url.hostname)) return [];
  return [`http://${url.host}`, `https://${url.host}`];
}

export function trustedOriginsFor(hostHeader: string | null | undefined, explicitBaseURL?: string): string[] {
  return [
    ...(explicitBaseURL ? [explicitBaseURL] : []),
    ...LOCAL_DEV_ORIGINS,
    ...reflectableHostOrigins(hostHeader),
  ];
}
