/**
 * 社交状态的纯解析（可单测）。
 *
 * 作用：从 Pixiv illust JSON 读出是否已红心/收藏/关注。
 * 用法：socialFromPixivIllust(body)；真正 POST 在 social.server.ts。
 */
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

function tokenFromRecord(rec: Record<string, unknown> | null | undefined): string | undefined {
  if (!rec) return undefined;
  for (const key of ["token", "csrfToken", "csrf_token", "tt"]) {
    if (isCsrfToken(rec[key])) return rec[key] as string;
  }
  const nested = rec.context ?? rec.pixiv ?? rec.pageProps ?? rec.props;
  if (nested && typeof nested === "object") {
    const hit = tokenFromRecord(nested as Record<string, unknown>);
    if (hit) return hit;
  }
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/"/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&/g, "&");
}

function parseMetaJson(html: string, id: string): Record<string, unknown> | null {
  const re = new RegExp(`id="${id}"[^>]*content=['"]([^'"]+)['"]`, "i");
  const alt = new RegExp(`content=['"]([^'"]+)['"][^>]*id="${id}"`, "i");
  const raw = html.match(re)?.[1] || html.match(alt)?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeEntities(raw)) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not json */
  }
  return null;
}

/**
 * 从 Pixiv HTML 抠 CSRF（`x-csrf-token` / `tt`）。
 *
 * 作用：红心、收藏、关注的 POST 必须带这个值。
 * 用法：extractPixivCsrfToken(homepageHtml)。
 * 为什么：官网现在把 token 放进 meta-global-data / 实体编码的 JSON，
 *        不再保证是十六进制，旧正则会在已登录时误报「请重新登录」。
 */
export function extractPixivCsrfToken(html: string): string | undefined {
  if (!html) return undefined;
  for (const id of ["meta-global-data", "meta-preload-data", "init-config"]) {
    const hit = tokenFromRecord(parseMetaJson(html, id));
    if (hit) return hit;
  }

  const decoded = decodeEntities(html);
  const quoted =
    decoded.match(/"token"\s*:\s*"([A-Za-z0-9_-]{16,128})"/)?.[1] ||
    decoded.match(/"csrfToken"\s*:\s*"([A-Za-z0-9_-]{16,128})"/)?.[1] ||
    decoded.match(/"csrf_token"\s*:\s*"([A-Za-z0-9_-]{16,128})"/)?.[1] ||
    decoded.match(/pixiv\.context\.token\s*=\s*"([^"]+)"/)?.[1];
  if (isCsrfToken(quoted)) return quoted;

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

