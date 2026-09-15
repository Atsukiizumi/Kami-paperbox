/**
 * 媒体主机私网守卫（SEC-08 前置修复）。
 *
 * 作用：判断媒体代理目标是否指向私网 / 回环——IP 字面量（IPv4、IPv6、
 *      IPv4-mapped、十进制 / 八进制 / 十六进制整数写法）同步判；域名经
 *      dns.lookup 解析后逐 IP 判（带 5 分钟 TTL 缓存）。
 * 用法：media.ts 在 parseAllowedMediaUrl（同步：normalizeIpLiteral +
 *      isPrivateHostname + isPrivateIpLiteral）与 loadMediaResponse（异步：
 *      await assertHostResolvesPublicly）里调用；单测用
 *      setHostGuardInternalsForTests 注入假解析器 / 时钟。依赖 node:dns /
 *      node:net，服务端专用，不要从客户端 import。
 * 为什么：旧 isPrivateIp 正则不认 IPv6 映射和整数写法、更不查 DNS
 *      （docs/05 SEC-08）。媒体白名单已把域收敛到图站自营域，这层是为将来
 *      放宽白名单扫清障碍，不改变现有合法 URL 的通过 / 拦截结果。
 */
import dns from "node:dns";
import net from "node:net";

/**
 * 私网 / 回环 / 链路本地 / 组播 / 保留段（IPv4 + IPv6）。比旧正则多出的段
 * （100.64/10、198.18/15、224/4、240/4、fe80::/10、ff00::/8）只会让原本就
 * 进不了白名单的 IP 字面量从「不支持的图片来源」改判成「非法地址」——
 * 拦截结论不变，只提前了判定点。
 */
const PRIVATE_RANGES = new net.BlockList();
for (const [addr, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  PRIVATE_RANGES.addSubnet(addr, prefix, family);
}

/** 域名形态的私网指示：本机、链路本地域、云 metadata 端点。 */
export function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  return false;
}

/** WHATWG IPv4 number parser：0x 十六进制 / 前导 0 八进制 / 十进制。 */
function parseIpv4Number(input: string): number | null {
  if (!input) return null;
  let base = 10;
  let digits = input;
  if (/^0[xX]/.test(input)) {
    base = 16;
    digits = input.slice(2);
    if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
  } else if (input.length > 1 && input.startsWith("0")) {
    base = 8;
    digits = input.slice(1);
    if (!/^[0-7]+$/.test(digits)) return null;
  } else if (!/^[0-9]+$/.test(input)) {
    return null;
  }
  const n = parseInt(digits, base);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 把整数写法的 IPv4 字面量折叠成点分十进制：2130706433 → 127.0.0.1，
 * 0177.0.0.1 / 0x7f.1 同理；非整数写法（含一切正常域名）原样返回。
 * 为什么还要做：new URL() 按 WHATWG 规则通常已把这类主机折叠好，但这里
 * 再归一一次，直接传 host 的调用方或未来运行时差异不至于绕过私网检查。
 */
export function normalizeIpLiteral(host: string): string {
  if (!host || host.includes(":")) return host;
  const parts = host.replace(/\.$/, "").split(".");
  if (parts.length > 4) return host;
  const numbers = parts.map(parseIpv4Number);
  if (numbers.some((n) => n === null)) return host;
  const last = parts.length - 1;
  // 非末段每段 < 256；末段承载剩余位（段数不足 4 时），整体不得超出 32 位
  for (let i = 0; i < last; i++) {
    if (numbers[i]! > 255) return host;
  }
  if (numbers[last]! >= 256 ** (4 - last)) return host;
  let value = 0;
  for (let i = 0; i < last; i++) value += numbers[i]! * 256 ** (3 - i);
  value += numbers[last]!;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/**
 * 把 IPv6 展开成 8 个 16 位组。实测 node:net 的 BlockList 对 IPv4-mapped
 * IPv6 的入桶 / 查桶行为不一致（::ffff:0.0.0.0/96 的桶查不到
 * ::ffff:127.0.0.1），所以映射形式在这里折叠成点分 IPv4 后走同一张表。
 */
function expandIpv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  // 点分 IPv4 尾只出现在最后一段（::ffff:1.2.3.4 形态），折成两个 16 位组
  const ending = right.length ? right : left;
  const tailDotted = ending[ending.length - 1];
  if (tailDotted && tailDotted.includes(".")) {
    const v4 = tailDotted.split(".");
    if (v4.length !== 4 || v4.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    ending.pop();
    ending.push((((Number(v4[0]) << 8) | Number(v4[1])) as number).toString(16));
    ending.push((((Number(v4[2]) << 8) | Number(v4[3])) as number).toString(16));
  }
  const fill = 8 - left.length - right.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : -1));
  return out.every((g) => g >= 0) ? out : null;
}

/** ::ffff:x / ::x（IPv4-mapped 与废弃的 IPv4-compatible）→ 点分 IPv4。 */
function ipv4MappedOf(address: string): string | null {
  const groups = expandIpv6(address);
  if (!groups) return null;
  const headZero = groups.slice(0, 5).every((g) => g === 0);
  if (!headZero || (groups[5] !== 0 && groups[5] !== 0xffff)) return null;
  return [(groups[6]! >> 8) & 255, groups[6]! & 255, (groups[7]! >> 8) & 255, groups[7]! & 255].join(".");
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return PRIVATE_RANGES.check(address, "ipv4");
  if (net.isIPv6(address)) {
    const mapped = ipv4MappedOf(address);
    if (mapped) return PRIVATE_RANGES.check(mapped, "ipv4");
    return PRIVATE_RANGES.check(address, "ipv6");
  }
  return false;
}

/** 同步路径用：入参是 IP 字面量时判私网，域名 / 非法串返回 false（域名走异步解析检查）。 */
export function isPrivateIpLiteral(host: string): boolean {
  return isPrivateAddress(host);
}

type LookupResult = { address: string; family: number };

const defaultResolve = (host: string): Promise<LookupResult[]> =>
  new Promise((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, addresses) =>
      err ? reject(err) : resolve(addresses),
    );
  });
const defaultNow = () => Date.now();

const GUARD_TTL_MS = 5 * 60_000;
const GUARD_CACHE_MAX = 512;
const resolutionCache = new Map<string, { verdict: boolean; at: number }>();
let resolveHost = defaultResolve;
let nowMs = defaultNow;

/** 仅测试用：注入假解析器 / 时钟并清空缓存；不传或传 null 还原。 */
export function setHostGuardInternalsForTests(
  overrides?: { resolve?: (host: string) => Promise<LookupResult[]>; now?: () => number } | null,
) {
  resolveHost = overrides?.resolve ?? defaultResolve;
  nowMs = overrides?.now ?? defaultNow;
  resolutionCache.clear();
}

/**
 * 域名解析结果里只要有一个私网地址就判不通过（多 A 记录不能让私网 IP 搭车）。
 * 解析失败 / 无结果时**放行**（fail-open）——取舍：白名单已把域收敛到图站
 * 自营域，lookup 失败本身给不了攻击者任何注入点，后续 outboundFetch 自会
 * 带着自己的解析去失败；若 fail-close，一次 DNS 抖动会把整站图片打成 400，
 * 可用性风险大于残余安全风险。成败结果一并缓存（5min TTL）：媒体请求热，
 * 不能每图一次 DNS。缓存的残余风险：域名在 TTL 窗口内从公网解析摆到私网
 * （rebinding 类攻击）最多有 5 分钟盲区——白名单域为图站自营域，常规解析
 * 不会摆到私网，盲区可接受。另注意 guard 通过 ≠ 连接安全：本函数与
 * outboundFetch 各自解析 DNS，存在解析后、连接前的 TOCTOU 窗口；彻底闭合
 * 需把解析结果钉进连接（自定义 undici dispatcher），白名单扩大到非自营域
 * 时应一并做。
 */
export async function assertHostResolvesPublicly(host: string): Promise<boolean> {
  const cached = resolutionCache.get(host);
  const now = nowMs();
  if (cached && now - cached.at < GUARD_TTL_MS) return cached.verdict;
  let verdict = true;
  try {
    const results = await resolveHost(host);
    verdict = !results.some((r) => isPrivateAddress(r.address));
  } catch {
    verdict = true; // fail-open，理由见函数头
  }
  if (resolutionCache.size >= GUARD_CACHE_MAX) resolutionCache.clear();
  resolutionCache.set(host, { verdict, at: now });
  return verdict;
}
