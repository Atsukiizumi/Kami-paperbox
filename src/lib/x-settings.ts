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
 * queryId 内置默认表（2026-10-26 实证：x-web 改版后 UserMedia→UserPhotoTimeline、
 * TweetResultByRestId→TweetResultById；X 发版后轮换）。镜像
 * upstream/x.ts 的 X_QUERY_IDS——那个模块连着服务端 HTTP 层不能进客户端包，
 * 占位符/设置卡从这里读；两处一致性由 x-account.test 交叉断言锁住。
 */
export const X_DEFAULT_QUERY_IDS: Record<XQueryIdKey, string> = {
  userByScreenName: "AMIBMjtxEEATh4z8V9GtRg",
  userMedia: "kc23mh5ZZHOao1q8hzZ1LQ",
  tweetResult: "UECplC_mh3SWNckOf1U3TA",
};

function normalizeHandle(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/^@/, "") : "";
}

/** X 保留路径词（小写比对）：镜像 upstream/pixiv.ts 的 X_RESERVED_TAIL_WORDS——
 * x.com/intent、/share、/home 等是功能路径不是 handle，撞上即弃；两处一致性由
 * x-link-card 组件测试的 URL 样本交叉断言锁住（同 X_DEFAULT_QUERY_IDS 防漂惯例）。 */
const X_RESERVED_INPUT_WORDS = new Set([
  "intent", "share", "home", "search", "hashtag", "explore", "settings",
  "messages", "notifications", "i", "compose", "account", "login",
  "signup", "sessions", "tos", "privacy", "personalization",
]);

function isValidXHandle(raw: string): boolean {
  return HANDLE_RE.test(raw) && !X_RESERVED_INPUT_WORDS.has(raw.toLowerCase());
}

/**
 * 手动录入框的 handle 三形态解析（M5 关联卡，客户端安全）：`@handle`（含全角
 * ＠）、裸 `handle`、x.com / twitter.com 个人页整条 URL（可无协议、可带
 * www / mobile 子域、可深链 /status/…、可带 ?query 与尾斜杠——统一取 host 后
 * 第一段）。尾段按 X 规则校验（字母数字下划线、≤15 位、不撞保留路径词）；
 * 非法输入（空 / 非法字符 / 超长 / 他站域名 URL）返回 undefined。
 * 为什么不直接用 upstream/pixiv.ts 的 twitterHandleFromUrl：它住在 server 适配
 * 器模块里（连带 http.ts → curl-fetch.server 的 node 依赖进不了客户端包），
 * 这里等价重写并收紧一处——手动录入必须核验域名属 X/Twitter，防止把
 * pixiv.net/users/123 之类他站 URL 的首段误当 handle 存进关联表。
 */
export function parseXHandleInput(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (!text.includes("/")) {
    const bare = text.replace(/^[@＠]/, "");
    return isValidXHandle(bare) ? bare : undefined;
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const onXSite =
    host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com");
  if (!onXSite) return undefined;
  const tail = url.pathname.split("/").filter(Boolean)[0] ?? "";
  return isValidXHandle(tail) ? tail : undefined;
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
