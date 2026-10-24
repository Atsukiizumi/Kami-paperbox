/**
 * X（Twitter）站点适配：web GraphQL + 用户 Cookie（auth_token + ct0）。
 *
 * 作用：handle→restId（UserByScreenName）、媒体时间线（UserMedia，光标翻页）、
 *       单推回源（TweetResultByRestId，队列下载用）。只读，无写操作。
 * 为什么走 web GraphQL：官方 API v2 免费档 ~100 读/月不可行（research §8）；
 *       网页前端自己就在打这三条，纸匣带同一份 Cookie 原样复打（docs/upstream.md 原则 2）。
 * 形态（M0 实测，research §9 / design §2.1）：**variables-only，无 features map**——
 *       新 x-web 架构用 providedVariables 替代，实证缺 features 亦 200。
 * 节流：X 对账号级程序化抓取敏感——本模块所有上游调用（含 guest activate）经
 *       模块级串行闸门（并发恒 1 + 相邻出口最小间隔，R6），429 文案对齐全局冷却正则。
 *
 * guest 回退：无 Cookie 时 UserByScreenName / TweetResultByRestId 仍可用
 *       （Bearer + x-guest-token），时间线（UserMedia）guest 404 必须真 Cookie。
 */
import type { FetchOk, WorkCard, WorkDetail, WorkPage } from "../types.ts";
import { asRecordOrNull } from "../parse.ts";
import { asNumber, asRecord, asString, UpstreamError, upstreamJson } from "./http.ts";

/** 相邻 X 上游调用的最小出口间隔（R6 保守节流）。导出供测试注入假时钟断言。 */
export const X_MIN_INTERVAL_MS = 1500;

/**
 * 闸门间隔的运行时注入点：kami.config.json 的 throttle.xMinIntervalMs（dispatch
 * 侧每次 X op 前刷新，对齐 throttle.server.ts 惯例）。默认 = X_MIN_INTERVAL_MS；
 * 非法值回落默认。测试用完记得 setXMinIntervalMs(X_MIN_INTERVAL_MS) 复位。
 */
let xMinIntervalMs = X_MIN_INTERVAL_MS;

export function setXMinIntervalMs(ms: number): void {
  xMinIntervalMs = Number.isFinite(ms) && ms > 0 ? ms : X_MIN_INTERVAL_MS;
}

/** 测试观测当前闸门间隔（生产不引用；M4 配置注入接线的断言用）。 */
export function xGateIntervalForTest(): number {
  return xMinIntervalMs;
}

/** UserMedia 单页条数（M0 实证变量形态用 20）。 */
const X_PAGE_COUNT = 20;

/** 推文文字截断长度（卡片 title 用 ~80 字，全文进 WorkDetail.description）。 */
const X_TITLE_MAX = 80;

/**
 * 公共 web bearer：X 网页前端匿名请求自带的稳定常量（社区多年未轮换），
 * 不是用户凭据——用户身份只靠 Cookie（auth_token + ct0）。
 * 导出供登录中转的 verify_credentials best-effort 身份探测共用（同为服务端侧）。
 */
export const X_WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export type XQueryKey = "userByScreenName" | "userMedia" | "tweetResult";

/**
 * GraphQL queryId 默认表——2026-10-18 实证值（research §9 浏览器实抓 + 重放验证）；
 * X 前端发版会轮换，设置段可覆盖（M4 接线，取法见 docs/reverse-engineering.md）。
 */
export const X_QUERY_IDS: Record<XQueryKey, string> = {
  userByScreenName: "yvm61GcJCIpqEwe_3RBccw",
  userMedia: "QWOimofaocjeRda7Tm5pNA",
  tweetResult: "xZfFqfOmKQu_OXekGI59mg",
};

export type XQueryIdOverrides = Partial<Record<XQueryKey, string>>;

/** 非空覆盖优先生效；空串 / 空白视为「未覆盖」，回落内置默认。 */
export function resolveXQueryIds(overrides?: XQueryIdOverrides): Record<XQueryKey, string> {
  const out = { ...X_QUERY_IDS };
  for (const key of Object.keys(X_QUERY_IDS) as XQueryKey[]) {
    const value = overrides?.[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

// ── 串行闸门（R6 核心）───────────────────────────────────────────────────────

export type XClock = { now(): number; sleep(ms: number): Promise<void> };

const defaultClock: XClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export type XGate = { chain: Promise<unknown>; lastExitAt: number };

/** lastExitAt 起步 -Infinity：进程内第一次调用不空等一个间隔。 */
export function newXGate(): XGate {
  return { chain: Promise.resolve(), lastExitAt: -Infinity };
}

/** 模块级闸门：本进程所有 X 上游调用共用（并发恒 1）。 */
const moduleGate = newXGate();

/**
 * 串行 + 最小间隔执行：任务排在 gate.chain 之后；相邻两次「出口」间隔不足
 * minIntervalMs 时先补眠。fn 抛错不毒化链（下一个任务照常排队）。
 * gate / clock 可注入——单测用假时钟断言排队与间隔，不真睡。
 */
export async function runExclusive<T>(
  gate: XGate,
  clock: XClock,
  minIntervalMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const task = gate.chain.then(async () => {
    const waitMs = gate.lastExitAt + minIntervalMs - clock.now();
    if (waitMs > 0) await clock.sleep(waitMs);
    try {
      return await fn();
    } finally {
      gate.lastExitAt = clock.now();
    }
  });
  gate.chain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

// ── Cookie 会话 ─────────────────────────────────────────────────────────────

export type XSession = { authToken: string; ct0: string };

/** X 上游专用 UA：比全局 UA 新两个大版本，降低「新 Cookie 也被 401」的指纹面。 */
export const X_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type XVerifyResult =
  | { ok: true; note: string }
  | { ok: false; kind: "expired" | "network" | "unknown"; reason: string };

/**
 * 凭据探针（docs/99 问题 1）：cookie 模式打一枪稳定账号（@x）的
 * UserByScreenName——凭据被拒在该链路恒为 401/32 → XCookieExpiredError，
 * 据此把「/x/ 报失效」拆成 凭据失效 / 网络 / 状态未知 三态给用户。
 * 不新增 GraphQL 端点：复用既有 queryId 与映射（@x 不存在才判 unknown）。
 */
export async function verifyXSession(
  xCookie: string | undefined,
  queryIdOverrides?: XQueryIdOverrides,
): Promise<XVerifyResult> {
  let session: XSession;
  try {
    session = requireXSession(xCookie);
  } catch (err) {
    return { ok: false, kind: "expired", reason: err instanceof Error ? err.message : "Cookie 缺失或不完整" };
  }
  const ids = resolveXQueryIds(queryIdOverrides);
  try {
    const user = mapXUserByScreenName(
      await xGraphQL({
        queryId: ids.userByScreenName,
        opName: "UserByScreenName",
        variables: {
          screenName: "x",
          __relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider: false,
        },
        session,
      }),
    );
    return { ok: true, note: `验证通过（X 官方账号可达：${user.name || "@x"}）` };
  } catch (err) {
    if (err instanceof XCookieExpiredError) {
      return { ok: false, kind: "expired", reason: "X 返回 401——凭据被拒（已失效或指纹被风控）" };
    }
    if (isUpstreamError(err) && (err.status === 429 || (err.status ?? 0) >= 500)) {
      const kind = err.status === 429 ? "unknown" : "network";
      return { ok: false, kind, reason: err.status === 429 ? "429 限速中——凭据状态未知，稍后再测" : `上游/网络错误（${err.status ?? "?"}）` };
    }
    return { ok: false, kind: "unknown", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** 从 Cookie 头原文里抠 auth_token / ct0（名称大小写不敏感）。 */
export function parseXCookie(raw: string): XSession {
  const out: XSession = { authToken: "", ct0: "" };
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (!value) continue;
    if (name === "auth_token") out.authToken = value;
    else if (name === "ct0") out.ct0 = value;
  }
  return out;
}

/**
 * X Cookie 失效专属标记错误（401 / 认证类 GraphQL 错误）。
 * 不继承 UpstreamError：这是用户态错误（回 400），前端（M6）靠 name 转
 * 「去设置更新 Cookie」引导（AC3），不当源站故障计 502。
 */
export class XCookieExpiredError extends Error {
  constructor(message = "X Cookie 已失效，请到设置更新") {
    super(message);
    this.name = "XCookieExpiredError";
  }
}

/** UserMedia（时间线）guest 404，必须真 Cookie——缺 / 残缺都给可读用户态错误。 */
function requireXSession(xCookie: string | undefined): XSession {
  const raw = xCookie?.trim();
  if (!raw) throw new Error("未配置 X Cookie：到 设置 → 站点账号 填入（auth_token 与 ct0）");
  const session = parseXCookie(raw);
  if (!session.authToken || !session.ct0) {
    throw new Error("X Cookie 不完整：需要同时带 auth_token 与 ct0 两个字段");
  }
  return session;
}

// ── guest token（无 Cookie 时的 UserByScreenName / TweetResultByRestId 回退）──

/** 模块级缓存：激活一次全进程复用；失效（401/403）由调用方清缓存重取。 */
let guestTokenCache: Promise<string> | null = null;

/** POST api.x.com/1.1/guest/activate.json（仅 Bearer，无 Cookie）换 guest token。 */
async function activateGuestToken(): Promise<string> {
  const json = await runExclusive(moduleGate, defaultClock, xMinIntervalMs, () =>
    upstreamJson("https://api.x.com/1.1/guest/activate.json", {
      origin: "x",
      method: "POST",
      headers: { Authorization: `Bearer ${X_WEB_BEARER}` },
    }),
  );
  const token = asString(asRecord(asRecord(json)).guest_token);
  if (!token) throw new UpstreamError("X 返回了无法解析的数据（guest token 缺失）");
  return token;
}

function ensureGuestToken(): Promise<string> {
  guestTokenCache ??= activateGuestToken().catch((err: unknown) => {
    guestTokenCache = null; // 激活失败不缓存坏 promise，下次重试
    throw err;
  });
  return guestTokenCache;
}

// ── GraphQL 通道 ─────────────────────────────────────────────────────────────

/** variables-only URL（M0 实证：无 features map，见文件头注释）。 */
function xGraphQLUrl(queryId: string, opName: string, variables: Record<string, unknown>): string {
  const qs = new URLSearchParams({ variables: JSON.stringify(variables) });
  return `https://x.com/i/api/graphql/${queryId}/${opName}?${qs.toString()}`;
}

function isUpstreamError(err: unknown): err is UpstreamError {
  return err instanceof UpstreamError || (err instanceof Error && err.name === "UpstreamError");
}

/**
 * GraphQL 200 响应里的 errors 信封：data 为空才算失败（部分错误可与数据共存）。
 * 导出供单测断言 88→「X 请求失败（429）」全角文案（queue-throttle 正则契约）。
 */
export function checkXGraphQLErrors(json: unknown): unknown {
  const rec = asRecord(json);
  const data = asRecord(rec.data);
  const errors = Array.isArray(rec.errors) ? rec.errors : [];
  if (errors.length === 0 || Object.keys(data).length > 0) return json;
  const first = asRecord(errors[0]);
  const code = asNumber(first.code);
  const message = asString(first.message) || "unknown";
  // 88 = rate limit：文案保持全角括号格式，让 queue-throttle 正则触发全局冷却
  if (code === 88 || /rate limit/i.test(message)) throw new UpstreamError("X 请求失败（429）", 429);
  if (code === 32 || code === 401 || /could not authenticate|unauthorized/i.test(message)) {
    throw new XCookieExpiredError();
  }
  throw new UpstreamError(`X 接口报错：${message.slice(0, 120)}`);
}

async function xGraphQLOnce(args: {
  queryId: string;
  opName: string;
  variables: Record<string, unknown>;
  session: XSession | null; // null = guest
  guestToken?: string;
}): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${X_WEB_BEARER}`,
    // X 对程序化访问敏感：全局通用 UA 是 Chrome/122（2024 年），太老会被
    // 当异常客户端拒——X 上游单独用现代版本（docs/99 问题 1 一环）。
    "User-Agent": X_UA,
  };
  let cookie: string | undefined;
  if (args.session) {
    // Cookie 模式三件套：auth_token + ct0 Cookie、csrf=ct0（GET 亦必带，缺则 403/353）
    cookie = `auth_token=${args.session.authToken}; ct0=${args.session.ct0}`;
    headers["x-csrf-token"] = args.session.ct0;
    headers["x-twitter-auth-type"] = "OAuth2Session";
    headers["x-twitter-active-user"] = "yes";
  } else if (args.guestToken) {
    headers["x-guest-token"] = args.guestToken;
  }
  let json: unknown;
  try {
    json = await upstreamJson(xGraphQLUrl(args.queryId, args.opName, args.variables), {
      cookie,
      origin: "x",
      headers,
    });
  } catch (err) {
    // Cookie 模式 401 = 会话失效（转专属标记，前端引导去设置）
    if (args.session && isUpstreamError(err) && err.status === 401) throw new XCookieExpiredError();
    throw err;
  }
  return checkXGraphQLErrors(json);
}

/**
 * 所有 GraphQL 调用的统一入口：过模块级串行闸门。guest 模式遇 401/403
 * （token 过期）清缓存重激活重试一次；其余错误原样上抛。
 */
async function xGraphQL(args: {
  queryId: string;
  opName: string;
  variables: Record<string, unknown>;
  session: XSession | null;
}): Promise<unknown> {
  const call = (guestToken?: string) =>
    runExclusive(moduleGate, defaultClock, xMinIntervalMs, () =>
      xGraphQLOnce({ ...args, guestToken }),
    );
  if (args.session) return call();
  let guestToken: string;
  try {
    guestToken = await ensureGuestToken();
    return await call(guestToken);
  } catch (err) {
    const staleToken = isUpstreamError(err) && (err.status === 401 || err.status === 403);
    if (!staleToken) throw err;
    guestTokenCache = null; // guest token 过期：重激活一次再试
    guestToken = await ensureGuestToken();
    return call(guestToken);
  }
}

// ── 响应 → Work 映射（纯函数，单测喂真实 fixtures）───────────────────────────

type XUserRef = { restId: string; name: string; handle: string; avatar: string };

/** 用户结果对象 → 四元组（core 新形态优先，legacy 旧客户端兜底）。 */
function xUserFromResult(result: Record<string, unknown>): XUserRef | null {
  const restId = asString(result.rest_id);
  const core = asRecord(result.core);
  const legacy = asRecord(result.legacy);
  const name = asString(core.name) || asString(legacy.name);
  const handle = asString(core.screen_name) || asString(legacy.screen_name);
  const avatar =
    asString(asRecord(result.avatar).image_url) || asString(legacy.profile_image_url_https);
  if (!restId || !handle) return null;
  return { restId, name, handle, avatar };
}

/**
 * 推文结果统一出口：TweetWithVisibilityResults 的真身在 .tweet 里（唯一要解包的
 * 形态）；坟墓 / 不可见返回 null（调用方按条目丢弃，不整体崩）。
 */
function xTweetResultOf(raw: Record<string, unknown>): Record<string, unknown> | null {
  const typename = asString(raw.__typename);
  if (typename === "TweetWithVisibilityResults") return asRecordOrNull(raw.tweet);
  if (typename === "TweetTombstone" || typename === "TweetUnavailable") return null;
  return raw;
}

function xUserOfTweet(tweet: Record<string, unknown>): XUserRef | null {
  const result = asRecord(asRecord(asRecord(tweet.core).user_results).result);
  const restId = asString(result.rest_id) || asString(asRecord(tweet.legacy).user_id_str);
  if (!restId) return null;
  const core = asRecord(result.core);
  const legacy = asRecord(result.legacy);
  const name = asString(core.name) || asString(legacy.name);
  const handle = asString(core.screen_name) || asString(legacy.screen_name);
  if (!handle) return null;
  const avatar =
    asString(asRecord(result.avatar).image_url) || asString(legacy.profile_image_url_https);
  return { restId, name, handle, avatar };
}

type XPhoto = { url: string; width?: number; height?: number };

/**
 * 静态图列表：legacy.entities.media 为主（M0 实证 UserMedia 响应的
 * extended_entities 为空数组）；extended 有货时优先（多图不塌缩）。只认
 * pbs.twimg.com 直链，只认 photo 类型（视频 / GIF 出范围）。
 */
function xPhotosOf(tweet: Record<string, unknown>): XPhoto[] {
  const entities = asRecord(asRecord(tweet.legacy).entities);
  const extended = asRecord(tweet.extended_entities);
  const rawMedia =
    Array.isArray(extended.media) && extended.media.length > 0 ? extended.media : entities.media;
  const out: XPhoto[] = [];
  if (!Array.isArray(rawMedia)) return out;
  for (const item of rawMedia) {
    const media = asRecord(item);
    if (asString(media.type) !== "photo") continue;
    const url = asString(media.media_url_https);
    if (!url.startsWith("https://pbs.twimg.com/")) continue;
    const info = asRecord(media.original_info);
    out.push({
      url,
      width: asNumber(info.width) > 0 ? asNumber(info.width) : undefined,
      height: asNumber(info.height) > 0 ? asNumber(info.height) : undefined,
    });
  }
  return out;
}

/**
 * pbs 直链加尺寸变体：`?format={ext}&name={small|large|orig}`（name=orig 是原图）。
 * format 从 URL 尾段推；jpg/jpeg/png/webp 之外的扩展名不拼参、保持原样
 * （M0 契约——X CDN 只认这四种 format，硬拼会 404）。
 */
export function xPbsVariant(url: string, name: "small" | "large" | "orig"): string {
  const base = url.split("?")[0] ?? url;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  if (!/^(jpe?g|png|webp)$/.test(ext)) return url;
  return `${base}?format=${ext}&name=${name}`;
}

function xTagsOf(tweet: Record<string, unknown>): string[] {
  const hashtags = asRecord(asRecord(tweet.legacy).entities).hashtags;
  const out: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hashtags)) return out;
  for (const item of hashtags) {
    const text = asString(asRecord(item).text).trim().toLowerCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** 推文文字：note_tweet（长推全文）优先；t.co 短链是展示噪音，剥掉。 */
function xTextOf(tweet: Record<string, unknown>): string {
  const note = asString(
    asRecord(asRecord(asRecord(asRecord(tweet.note_tweet).note_tweet_results).result).text),
  );
  const text = note || asString(asRecord(tweet.legacy).full_text);
  return text
    .replace(/https:\/\/t\.co\/[A-Za-z0-9]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xTitleOf(text: string, id: string): string {
  if (!text) return `X 推文 ${id}`;
  return text.length > X_TITLE_MAX ? `${text.slice(0, X_TITLE_MAX)}…` : text;
}

/**
 * 推 → 卡片。返回 null = 防御性丢弃：转发结构（UserMedia 理论只含原创媒体推，
 * 这里再兜一道：legacy.retweeted_status[_result] 存在即丢）、无静态图（纯文字 /
 * 纯视频）、缺 rest_id / 用户信息。
 */
export function mapXTweetCard(
  tweet: Record<string, unknown>,
  fallbackUser?: XUserRef | null,
): WorkCard | null {
  const legacy = asRecord(tweet.legacy);
  if (legacy.retweeted_status !== undefined || legacy.retweeted_status_result !== undefined) {
    return null;
  }
  const id = asString(tweet.rest_id);
  if (!id) return null;
  const user = xUserOfTweet(tweet) ?? fallbackUser ?? null;
  if (!user) return null;
  const photos = xPhotosOf(tweet);
  if (photos.length === 0) return null;
  const text = xTextOf(tweet);
  return {
    source: "x",
    id,
    title: xTitleOf(text, id),
    // 显示名 @handle：authorId 是 restId 身份键，handle 藏在这里供原推链接回收
    //（sites.xHandleFromAuthor）
    author: user.name ? `${user.name}@${user.handle}` : `@${user.handle}`,
    authorId: user.restId,
    thumb: xPbsVariant(photos[0]!.url, "small"),
    pageCount: photos.length,
    tags: xTagsOf(tweet),
    width: photos[0]?.width,
    height: photos[0]?.height,
    // possibly_sensitive → xRestrict=1（对齐 fanbox hasAdultContent→1 口径，D1 角标数据源）
    xRestrict: legacy.possibly_sensitive === true ? 1 : undefined,
    date: asString(legacy.created_at) || undefined,
    excerpt: text || undefined,
  };
}

function xPagesOf(photos: XPhoto[]): WorkPage[] {
  return photos.map((photo) => ({
    thumb: xPbsVariant(photo.url, "small"),
    regular: xPbsVariant(photo.url, "large"),
    original: xPbsVariant(photo.url, "orig"),
    width: photo.width,
    height: photo.height,
    kind: "image" as const,
  }));
}

/** TweetResultByRestId 响应（扁平 data.tweetResult.result）→ 作品详情（队列回源）。 */
export function mapXTweetDetail(json: unknown): WorkDetail | null {
  const data = asRecordOrNull(asRecord(json).data);
  const wrapper = asRecordOrNull(asRecordOrNull(data?.tweetResult)?.result);
  if (!wrapper) return null;
  // 先剥 TweetWithVisibilityResults 包裹再验 rest_id（包裹层自己不带 rest_id）
  const tweet = xTweetResultOf(wrapper);
  if (!tweet || !asString(tweet.rest_id)) return null;
  const card = mapXTweetCard(tweet);
  if (!card) return null;
  return {
    ...card,
    description: xTextOf(tweet),
    pages: xPagesOf(xPhotosOf(tweet)),
    likes: asNumber(asRecord(tweet.legacy).favorite_count) || undefined,
  };
}

/** UserByScreenName 响应 → 用户四元组。找不到给可读错误（用户态 400），不崩。 */
export function mapXUserByScreenName(json: unknown): XUserRef {
  const data = asRecordOrNull(asRecord(json).data);
  // 新 x-web 根字段是 user_result_by_screen_name；旧客户端（queryId 被覆盖时）是 user
  const wrap = asRecordOrNull(data?.user_result_by_screen_name) ?? asRecordOrNull(data?.user);
  const ref = wrap ? xUserFromResult(asRecord(wrap.result)) : null;
  if (!ref) throw new Error("X 用户不存在或已改名");
  return ref;
}

/**
 * UserMedia 响应 → { user, items, nextCursor }。
 * - userId 无效时上游**静默**返回 `{"data":{"user":{}}}`（M0 实证）——判空抛
 *   可读错误，别把空用户当正常空页；
 * - 媒体格是 TimelineTimelineModule（一模块≈一天聚合），推文在
 *   content.items[].item.itemContent.tweet_results.result，展平；Top 游标 /
 *   Terminate 属正常噪音，忽略，只回收 Bottom；
 * - 单条推文坏 / 转发 / 无图按条丢弃，不整体崩。
 */
export function mapXUserMedia(json: unknown, fallbackUser?: XUserRef | null): {
  user: { restId: string };
  items: WorkCard[];
  nextCursor?: string;
} {
  const data = asRecordOrNull(asRecord(json).data);
  const userResult = asRecordOrNull(asRecordOrNull(data?.user)?.result);
  const restId = asString(userResult?.rest_id);
  if (!userResult || !restId) throw new UpstreamError("X 用户不存在或 Cookie 已失效");
  // 新旧客户端时间线根：timeline（x-web）/ timeline_v2（旧 responsive-web）
  const timelineWrap =
    asRecordOrNull(userResult.timeline_v2) ?? asRecordOrNull(userResult.timeline);
  const instructions = asRecord(asRecord(timelineWrap?.timeline).instructions);
  if (!Array.isArray(instructions)) {
    throw new UpstreamError("X 返回了无法解析的数据（缺少时间线）");
  }
  const items: WorkCard[] = [];
  let nextCursor = "";
  const pushTweet = (raw: unknown): void => {
    const tweet = xTweetResultOf(asRecord(raw));
    if (!tweet) return;
    const card = mapXTweetCard(tweet, fallbackUser);
    if (card) items.push(card);
  };
  for (const instruction of instructions) {
    const rec = asRecord(instruction);
    if (asString(rec.type) !== "TimelineAddEntries") continue;
    const entries = Array.isArray(rec.entries) ? rec.entries : [];
    for (const entry of entries) {
      const content = asRecord(asRecord(entry).content);
      const entryType = asString(content.entryType);
      if (entryType === "TimelineTimelineCursor") {
        if (asString(content.cursorType) === "Bottom") nextCursor = asString(content.value);
        continue; // Top / Terminate 游标是翻页噪音
      }
      if (entryType === "TimelineTimelineModule") {
        // 媒体模块：一天聚合，items 逐条都是推
        const moduleItems = Array.isArray(content.items) ? content.items : [];
        for (const mod of moduleItems) {
          const itemContent = asRecord(asRecord(asRecord(mod).item).itemContent);
          if (asString(itemContent.itemType) === "TimelineTweet" || itemContent.tweet_results) {
            pushTweet(asRecord(itemContent.tweet_results).result);
          }
        }
        continue;
      }
      if (entryType === "TimelineTimelineItem") {
        // 旧形态（置顶推等）：顶层单条
        const itemContent = asRecord(content.itemContent);
        if (asString(itemContent.itemType) === "TimelineTweet" || itemContent.tweet_results) {
          pushTweet(asRecord(itemContent.tweet_results).result);
        }
      }
    }
  }
  return { user: { restId }, items, ...(nextCursor ? { nextCursor } : {}) };
}

// ── 对外入口（dispatch 调用）───────────────────────────────────────────────

/**
 * handle → 媒体时间线一页。每页两次上游调用（handle→restId + UserMedia），
 * 均过闸门；UserMedia 必须真 Cookie（guest 404），所以整 op 前置校验 Cookie。
 * user 的 name / avatar 取自 UserByScreenName（UserMedia 响应的 user 只有 restId）。
 */
export async function xUserMedia(
  handle: string,
  cursor: string | undefined,
  xCookie: string | undefined,
  queryIdOverrides?: XQueryIdOverrides,
): Promise<Extract<FetchOk, { op: "xUserMedia" }>> {
  const session = requireXSession(xCookie);
  const ids = resolveXQueryIds(queryIdOverrides);
  const user = mapXUserByScreenName(
    await xGraphQL({
      queryId: ids.userByScreenName,
      opName: "UserByScreenName",
      // provided variable 必填（缺则 422 GRAPHQL_VALIDATION_FAILED，M0 实证）
      variables: {
        screenName: handle,
        __relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider: false,
      },
      session,
    }),
  );
  const page = mapXUserMedia(
    await xGraphQL({
      queryId: ids.userMedia,
      opName: "UserMedia",
      variables: {
        userId: user.restId,
        count: X_PAGE_COUNT,
        includePromotedContent: false,
        withQuickPromoteEligibility: false,
        withVoice: false,
        ...(cursor ? { cursor } : {}),
      },
      session,
    }),
    user,
  );
  return {
    op: "xUserMedia",
    items: page.items,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    user: { restId: user.restId, name: user.name, avatar: user.avatar },
  };
}

/** 单推回源（队列下载）。TweetResultByRestId guest 亦可——无 Cookie 走 guest。 */
export async function xTweet(
  id: string,
  xCookie: string | undefined,
  queryIdOverrides?: XQueryIdOverrides,
): Promise<Extract<FetchOk, { op: "xTweet" }>> {
  const ids = resolveXQueryIds(queryIdOverrides);
  // 填了 Cookie 就按完整会话校验（缺一半给可读错误），没填走 guest
  const raw = xCookie?.trim();
  const session = raw ? requireXSession(xCookie) : null;
  const json = await xGraphQL({
    queryId: ids.tweetResult,
    opName: "TweetResultByRestId",
    variables: {
      tweetId: id,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    },
    session,
  });
  const work = mapXTweetDetail(json);
  if (!work) throw new Error("X 推文不存在、已删除或没有静态图");
  return { op: "xTweet", work };
}
