/**
 * X（Twitter）设置段解析与 Cookie 清洗（v16，前后端共用）。
 *
 * 作用：xCookie / xAssociations / xGraphQLQueryIds 三个设置段的白名单清洗——
 *       persist 迁移、备份解析、服务端会话镜像共用同一套宽松口径（类型不对
 *       给默认值，坏条目丢弃），对齐 sanitizePixivCookie / parseCollections 惯例。
 * 为什么不 import upstream/x.ts：那是服务端适配器（http.ts 连着 node 依赖），
 *       设置段在客户端也要跑；两处 queryId 键名由组件测试交叉断言锁住。
 */
import type { XAssociation, XQueryIdKey } from "./types.ts";

/** auth_token（约 40 位十六进制）与 ct0（base64 形态，含 -_）。宽松上下界：只挡非令牌噪声。 */
const AUTH_TOKEN_RE = /(?:^|[\s;])auth_token=([A-Za-z0-9_-]{8,120})/i;
const CT0_RE = /(?:^|[\s;])ct0=([A-Za-z0-9_-]{8,160})/i;

/**
 * 从用户粘贴的 Cookie 原文里只回收 auth_token 与 ct0，重拼规范形态
 * `auth_token=…; ct0=…`；任一缺失返回 ""（时间线接口两者都必需，与 x.ts
 * requireXSession 同口径）。整段 DevTools Cookie 头粘贴也能提出这两项，
 * 其余字段（guest_id / twid 等）一律丢弃。
 */
export function sanitizeXCookie(raw?: string): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  const authToken = AUTH_TOKEN_RE.exec(text)?.[1];
  const ct0 = CT0_RE.exec(text)?.[1];
  return authToken && ct0 ? `auth_token=${authToken}; ct0=${ct0}` : "";
}

/** X handle（@ 后那段）：1–15 位字母数字下划线，与 fetchSchema xUserMedia 同口径。 */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const REST_ID_RE = /^\d{1,20}$/;
/** 关联条目上限：对齐画师侧存储量级（watchArtists 上限 500 同档）。 */
export const X_ASSOCIATION_LIMIT = 500;
/** 每位画师最多忽略的候选 handle 数（防脏档撑爆备份）。 */
const IGNORED_LIMIT = 50;
/** queryId 覆盖值形态：X 前端 chunk 里的 Relay params.id（22 位左右）。 */
const QUERY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * queryId 内置默认表（2026-10-18 实证，research §9；X 发版后轮换）。镜像
 * upstream/x.ts 的 X_QUERY_IDS——那个模块连着服务端 HTTP 层不能进客户端包，
 * 占位符/设置卡从这里读；两处一致性由 x-account.test 交叉断言锁住。
 */
export const X_DEFAULT_QUERY_IDS: Record<XQueryIdKey, string> = {
  userByScreenName: "yvm61GcJCIpqEwe_3RBccw",
  userMedia: "QWOimofaocjeRda7Tm5pNA",
  tweetResult: "xZfFqfOmKQu_OXekGI59mg",
};

function normalizeHandle(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/^@/, "") : "";
}

/**
 * 解析外部（旧档迁移 / 备份 / 同步段）来的关联表：键 = authorKey，值逐项校验
 * （handle 合法、origin 只认 auto/manual），坏条目丢弃、超限截取。
 */
export function parseXAssociations(raw: unknown): Record<string, XAssociation> {
  const out: Record<string, XAssociation> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= X_ASSOCIATION_LIMIT) break;
    const key = rawKey.trim();
    if (!key || key.length > 120) continue;
    if (!rawVal || typeof rawVal !== "object") continue;
    const rec = rawVal as Record<string, unknown>;
    const handle = normalizeHandle(rec.handle);
    if (!HANDLE_RE.test(handle)) continue;
    if (rec.origin !== "auto" && rec.origin !== "manual") continue;
    const assoc: XAssociation = {
      handle,
      origin: rec.origin,
      addedAt: Number(rec.addedAt) || 0,
    };
    if (typeof rec.restId === "string" && REST_ID_RE.test(rec.restId)) assoc.restId = rec.restId;
    if (Array.isArray(rec.ignoredHandles)) {
      const seen = new Set<string>();
      const ignored: string[] = [];
      for (const item of rec.ignoredHandles) {
        const h = normalizeHandle(item);
        if (!HANDLE_RE.test(h) || seen.has(h)) continue;
        seen.add(h);
        ignored.push(h);
        if (ignored.length >= IGNORED_LIMIT) break;
      }
      if (ignored.length) assoc.ignoredHandles = ignored;
    }
    out[key] = assoc;
  }
  return out;
}

/** 解析 queryId 覆盖：只认三个已知键，值必须是非空 queryId 形态；空串 = 未覆盖（丢弃）。 */
export function parseXQueryIdOverrides(raw: unknown): Partial<Record<XQueryIdKey, string>> {
  const out: Partial<Record<XQueryIdKey, string>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  const keys: readonly XQueryIdKey[] = ["userByScreenName", "userMedia", "tweetResult"];
  for (const key of keys) {
    if (typeof rec[key] !== "string") continue;
    const value = (rec[key] as string).trim();
    if (!QUERY_ID_RE.test(value)) continue;
    out[key] = value;
  }
  return out;
}
