/**
 * 社交状态的纯解析（可单测）。
 *
 * 作用：从 Pixiv illust JSON 读出是否已红心/收藏/关注。
 * 用法：socialFromPixivIllust(body)；真正 POST 在 social.server.ts。
 */
import { decodeHtmlEntities } from "./utils.ts";
export type SocialState = {
  liked: boolean;
  bookmarked: boolean;
  bookmarkId?: string;
  followed: boolean;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export function socialFromPixivIllust(body: Record<string, unknown>): SocialState {
  const bookmark = asRecord(body.bookmarkData);
  const bookmarkId = asString(bookmark.id);
  const like = body.likeData;
  const liked =
    like === true ||
    (like !== null && typeof like === "object" && (like as { isLiked?: unknown }).isLiked === true);
  return {
    liked,
    bookmarked: Boolean(bookmarkId),
    bookmarkId: bookmarkId || undefined,
    followed: body.isFollowed === true,
  };
}

export function bookmarkTagsOf(tags: readonly string[]): string[] {
  return tags
    .map((t) => t.trim())
    .filter((t) => t && t.length <= 30 && !/^r-?18/i.test(t))
    .slice(0, 10);
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

function isCsrfToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not json */
  }
  return null;
}

function tokenFromRecord(rec: Record<string, unknown> | null | undefined, depth = 0): string | undefined {
  if (!rec || depth > 8) return undefined;
  for (const key of ["token", "csrfToken", "csrf_token", "tt"]) {
    if (isCsrfToken(rec[key])) return rec[key] as string;
  }
  for (const key of ["api", "context", "pixiv", "pageProps", "props"]) {
    const nested = rec[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const hit = tokenFromRecord(nested as Record<string, unknown>, depth + 1);
      if (hit) return hit;
    }
    if (typeof nested === "string" && nested.startsWith("{")) {
      const hit = tokenFromRecord(parseJsonObject(nested), depth + 1);
      if (hit) return hit;
    }
  }
  const serialized = rec.serverSerializedPreloadedState;
  if (typeof serialized === "string" && serialized.startsWith("{")) {
    const hit = tokenFromRecord(parseJsonObject(serialized), depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function attributeValue(tag: string, name: string): string | undefined {
  const single = tag.match(new RegExp(`${name}='([^']*)'`, "i"));
  if (single?.[1] != null) return decodeHtmlEntities(single[1]);
  const double = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  if (double?.[1] != null) return decodeHtmlEntities(double[1]);
  return undefined;
}

function parseTaggedJson(html: string, id: string): Record<string, unknown> | null {
  const tag =
    html.match(new RegExp(`<[^>]*\\sid="${id}"[^>]*>`, "i"))?.[0] ||
    html.match(new RegExp(`<[^>]*id='${id}'[^>]*>`, "i"))?.[0];
  if (!tag) return null;
  const raw = attributeValue(tag, "content") ?? attributeValue(tag, "value");
  return raw ? parseJsonObject(raw) : null;
}

function parseNextData(html: string): Record<string, unknown> | null {
  const raw = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  return raw ? parseJsonObject(raw.trim()) : null;
}

/**
 * 从 Pixiv HTML 抠 CSRF（`x-csrf-token` / `tt`）。
 *
 * 作用：红心、收藏、关注的 POST 必须带这个值。
 * 用法：extractPixivCsrfToken(homepageHtml)。
 * 为什么：旧站把 token 放进 meta-global-data；作品页 / 榜单已换成 Next.js，
 *        token 在 __NEXT_DATA__ → serverSerializedPreloadedState.api.token。
 */
export function extractPixivCsrfToken(html: string): string | undefined {
  if (!html) return undefined;
  for (const id of ["meta-global-data", "meta-preload-data", "init-config"]) {
    const hit = tokenFromRecord(parseTaggedJson(html, id));
    if (hit) return hit;
  }

  const next = tokenFromRecord(parseNextData(html));
  if (next) return next;

  const decoded = decodeHtmlEntities(html);
  for (const re of [
    /"token"\s*:\s*"([A-Za-z0-9_-]{16,128})"/g,
    /"csrfToken"\s*:\s*"([A-Za-z0-9_-]{16,128})"/g,
    /"csrf_token"\s*:\s*"([A-Za-z0-9_-]{16,128})"/g,
    /pixiv\.context\.token\s*=\s*"([^"]+)"/g,
  ]) {
    for (const m of decoded.matchAll(re)) {
      if (isCsrfToken(m[1])) return m[1];
    }
  }

  const meta =
    html.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']csrf-token["']/i)?.[1];
  if (isCsrfToken(meta)) return meta;
  return undefined;
}

export function pixivHtmlLooksLoggedOut(html: string): boolean {
  if (!html) return true;
  if (/accounts\.pixiv\.net\/login/i.test(html) && /name=["']password["']/i.test(html)) return true;
  if (/"isLogin"\s*:\s*false/.test(html) || /"is_login"\s*:\s*false/.test(html)) return true;
  return false;
}

