/**
 * 自托管 Better Auth（仅服务端）。
 *
 * 作用：本应用自己的账号体系（邮箱 + 密码），跑在同源 `/api/auth/*`，
 *      会话 cookie 留在本应用自己的域上。
 * 形态：
 *   - 开（默认，`VITE_AUTH_ENABLED` 非 "false"）：真实邮箱密码登录，
 *     数据落 PGlite（本机，无 `DATABASE_URL` 时）或 Postgres（设置了时）。
 *   - 关（`VITE_AUTH_ENABLED=false`，如 Docker 默认形态）：无账号体系，
 *     数据面走局域网配对令牌（见 auth/lan-token.server.ts）。
 *
 * 历史：曾通过 Grok auth broker 联邦登录（genericOAuth + grok-gate 身份
 * 头 + preview 共享 client），平台退出（TD-04 / R-06）后整条链路已删，
 * 本文件只剩邮箱密码一条通道。永远不要从客户端代码导入本文件。
 */
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getActiveRequest, readRequestCookie } from "../request-context.ts";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { pgliteDialect } from "./pglite-dialect";

// PGLite（及会话行）挂在 globalThis 上共享，本文件的签名密钥也要扛住
// HMR 重载：进程内稳定，重启随 PGLite 一起清空。
void ensureDbReady();

const globalAuthRef = globalThis as typeof globalThis & {
  __kamiAuthSecret__?: string;
};
function processStableSecret(): string {
  globalAuthRef.__kamiAuthSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__kamiAuthSecret__;
}

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

// 显式关闭开关（Docker 形态烧 false）。
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

/** True when the email/password account system is active. */
export const authConfigured = !authDisabled && emailAndPasswordEnabled;

// 本应用自己的 Better Auth origin。部署形态注入 BETTER_AUTH_URL；本机
// dev 是端口 8080 契约 —— 浏览器可能用 localhost / 127.0.0.1 / [::1]
// 任意一个访问同一服务，只信 localhost 会把 127.0.0.1 拒了（Invalid origin）。
const explicitBaseURL = env("BETTER_AUTH_URL");
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];
const baseURL = explicitBaseURL ?? "http://localhost:8080";

// credentialed POST（注册/登录等）接受的 Origin；缺了会 403 "Invalid origin"。
// Better Auth 接受「数组 或 单个 (request) => string[]」；这里用函数动态给：
// 局域网同源放行——手机 / 平板用 http://<电脑IP>:8080 打开应用时，Origin
// 就是这个 host，与请求自身 Host 一致的 Origin 按定义即同源，放行；
// 真正的跨站 Origin（别的网站脚本发起）仍然被拒。
function trustedOriginsOf(request?: Request): string[] {
  const host = request?.headers.get("host");
  return [
    ...(explicitBaseURL ? [explicitBaseURL] : []),
    ...LOCAL_DEV_ORIGINS,
    ...(host ? [`http://${host}`, `https://${host}`] : []),
  ];
}

const databaseUrl = env("DATABASE_URL");

// 有 DATABASE_URL 用真 Postgres（部署），否则用应用同一个内嵌 PGlite
// （Kysely 方言）——邮箱用户和账号数据同库，auth schema 见
// migrations/0001_auth.sql。
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie 名。 */
export const SESSION_TOKEN_COOKIE = "kami-auth.session_token";

export const auth = betterAuth({
  baseURL,
  // 部署注入 BETTER_AUTH_SECRET；本机进程内稳定（见上）。
  secret: env("BETTER_AUTH_SECRET") ?? processStableSecret(),
  database,

  trustedOrigins: trustedOriginsOf,

  // 短时签名的 session_data cookie 缓存会话，读（含 /get-session）
  // 不打 DB，缩小 loading 窗口、减少闪烁。
  session: { cookieCache: { enabled: true, maxAge: 300 } },

  // 本地邮箱密码 —— 开关只在 ./email-password。
  ...(emailAndPasswordEnabled ? { emailAndPassword: { enabled: true } } : {}),

  // Cookie 策略按本机自托管调整：应用常通过 http://127.0.0.1 或局域网 IP 访问，
  // `__Host-` 前缀要求 Secure，浏览器在纯 http 的局域网源上会直接拒收，登录态
  // 存不住。改用普通名字 + sameSite=lax（Better Auth 默认 httpOnly），http/https
  // 都能用。这是自己一个人的本机应用，不存在多应用同域互扔 Cookie 的场景。
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: false, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "kami-auth.session_data" },
      account_data: { name: "kami-auth.account_data" },
      dont_remember: { name: "kami-auth.dont_remember" },
    },
  },

  plugins: [
    // 把 Better Auth 的 Set-Cookie 桥接进 Next.js。必须放最后。
    nextCookies(),
  ],
});

export function readSessionToken(): string | null {
  return readRequestCookie(getActiveRequest(), SESSION_TOKEN_COOKIE);
}
