/**
 * Pixiv / FANBOX / X 会话格式（前后端共用，不要从 accounts.ts 再引回来，会循环）。
 *
 * 作用：辨认已登录 Cookie、丢掉访客令牌、拼请求头、给出官方登录 URL；
 *      浏览器候选链（chromeCandidates / orderLaunchCandidates）与按站的
 *      启动策略（launchAttemptsForSite）也在这里——纯函数，单测直测。
 * 用法：isPixivLoggedInSession(raw)；fanboxCookieHeader(fanbox, pixivFallback)；
 *      pickXSession(cdpCookies)。
 * 为什么：登录页一打开就会种下没有 `用户ID_` 的访客 PHPSESSID，当成登录会全 401。
 *        FANBOX 必须走 accounts.pixiv.net → /auth/start，会话常和 Pixiv 是同一串。
 *        X 的登录态没有访客歧义：`.x.com` 域 auth_token（HttpOnly）+ ct0 成对出现
 *        即已登录，缺 ct0 时 sanitizeXCookie 双值门槛会拒——pickXSession 直接返回 null。
 */
export type CookieLike = {
  name: string;
  value: string;
  domain?: string;
};

export type BrowserSession = {
  pixiv: string;
  fanbox: string;
};

export type LoginSite = "pixiv" | "fanbox" | "x";

export type LoginJobStatus = "idle" | "launching" | "waiting" | "done" | "error";

export type LoginJobSnapshot = {
  status: LoginJobStatus;
  site: LoginSite | null;
  error: string | null;
  chrome: string | null;
  relay: boolean;
  pageUrl: string;
  viewWidth: number;
  viewHeight: number;
  frame: string | null;
  pixiv: string;
  fanbox: string;
  x: string;
  pixivProfile: { id: string; name: string; avatar?: string } | null;
  fanboxProfile: { id: string; name: string; avatar?: string } | null;
};

export type LoginInputEvent =
  | {
      type: "mouse";
      action: "pressed" | "released" | "moved" | "wheel";
      x: number;
      y: number;
      button?: number;
      deltaX?: number;
      deltaY?: number;
    }
  | {
      type: "key";
      action: "down" | "up";
      key: string;
    }
  | {
      type: "text";
      text: string;
    };

export const LOGIN_VIEW = { width: 980, height: 720 } as const;

export const PIXIV_LOGIN_URL =
  "https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F&source=pc&view_type=page";

/** Official FANBOX login: Pixiv account picker, then bounce through /auth/start. */
export const FANBOX_LOGIN_URL =
  "https://accounts.pixiv.net/login?prompt=select_account&return_to=https%3A%2F%2Fwww.fanbox.cc%2Fauth%2Fstart&source=fanbox";

export const FANBOX_AUTH_START = "https://www.fanbox.cc/auth/start";

/**
 * Official X login flow entry. Bounce to the x.com home page and clicking
 * "Log in" manually is also acceptable — the poll only cares about cookies.
 */
export const X_LOGIN_URL = "https://x.com/i/flow/login";

/**
 * R3（X 中转 403）：中转页面被 X/Cloudflare 拒（HTTP 403）时的错误文案——
 * 引导手贴 Cookie 兜底。服务端 runJob 收到 403 文档响应即以本文案转错误态；
 * error 终态保留 token 供发起方单次补读（browser-login.server.ts 的
 * readLoginJobForRelay，P1 修复），下一次 280ms 轮询送达，前端 session-relay
 * 按 job.error 原样展示（口径：密码只打在官方页）。
 */
export const X_RELAY_403_HINT =
  "X 拒绝了自动浏览器（HTTP 403）。请改用手贴 Cookie：设置 → 账号，粘贴 auth_token 与 ct0。";

/** Logged-in Pixiv PHPSESSID is `{memberId}_{token}`. Guest sessions are a bare token. */
export const PIXIV_SESSION_RE = /^(\d{1,12})_([A-Za-z0-9._-]{8,})$/;

export function loginJobBusy(status: LoginJobStatus): boolean {
  return status === "launching" || status === "waiting";
}

/** 登录中转 site 参数白名单解析（login-browser 路由用）：未知值返回 null → 400。 */
export function parseLoginSite(raw: unknown): LoginSite | null {
  return raw === "pixiv" || raw === "fanbox" || raw === "x" ? raw : null;
}

export function stripCookieName(raw: string, name: string): string {
  const v = raw.trim();
  if (!v) return "";
  const prefix = `${name}=`;
  return v.toLowerCase().startsWith(prefix.toLowerCase()) ? v.slice(prefix.length).trim() : v;
}

export function pixivSessionValue(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const embedded = /PHPSESSID=([^;\s]+)/i.exec(v);
  if (embedded?.[1]) return embedded[1].trim();
  return stripCookieName(v, "PHPSESSID");
}

export function fanboxSessionValue(raw: string): string {
  return stripCookieName(raw, "FANBOXSESSID");
}

export function isPixivLoggedInSession(raw: string): boolean {
  return PIXIV_SESSION_RE.test(pixivSessionValue(raw));
}

export function isFanboxLoggedInSession(raw: string): boolean {
  return PIXIV_SESSION_RE.test(fanboxSessionValue(raw));
}

export function pixivUserIdFromCookie(raw?: string): string | undefined {
  const match = PIXIV_SESSION_RE.exec(pixivSessionValue(raw ?? ""));
  return match?.[1];
}

export function sanitizePixivCookie(raw?: string): string {
  const value = pixivSessionValue(raw ?? "");
  return isPixivLoggedInSession(value) ? value : "";
}

export function sanitizeFanboxCookie(raw?: string): string {
  const value = fanboxSessionValue(raw ?? "");
  if (isFanboxLoggedInSession(value)) return value;
  return sanitizePixivCookie(value);
}

export function pixivCookieHeader(raw?: string): string | undefined {
  const value = sanitizePixivCookie(raw);
  if (!value) return undefined;
  return `PHPSESSID=${value}`;
}

export function fanboxSessionFrom(fanbox?: string, pixiv?: string): string {
  return sanitizeFanboxCookie(fanbox) || sanitizePixivCookie(pixiv);
}

export function fanboxCookieHeader(raw?: string, pixivFallback?: string): string | undefined {
  const fanbox = fanboxSessionFrom(raw, pixivFallback);
  if (!fanbox) return undefined;
  const pixiv = sanitizePixivCookie(pixivFallback) || fanbox;
  return `FANBOXSESSID=${fanbox}; PHPSESSID=${pixiv}`;
}

export function withPixivUserId(
  headers: Record<string, string>,
  raw?: string,
): Record<string, string> {
  const id = pixivUserIdFromCookie(raw);
  if (id) headers["x-userid"] = id;
  return headers;
}

export function pickSession(cookies: CookieLike[]): BrowserSession {
  let pixiv = "";
  let fanbox = "";
  for (const cookie of cookies) {
    const name = cookie.name.toLowerCase();
    const value = cookie.value.trim();
    if (!value) continue;
    const domain = (cookie.domain ?? "").toLowerCase();
    if (name === "phpsessid" && isPixivLoggedInSession(value)) {
      const session = pixivSessionValue(value);
      if (!domain || domain.includes("pixiv")) pixiv = session;
      if (domain.includes("fanbox") && !fanbox) fanbox = session;
    }
    if (name === "fanboxsessid" && isFanboxLoggedInSession(value)) {
      if (!domain || domain.includes("fanbox") || domain.includes("pixiv")) fanbox = fanboxSessionValue(value);
    }
  }
  return { pixiv, fanbox };
}

/** `.x.com`（含 x.com / *.x.com）域判断；X 会话 Cookie 都种在这棵域上。 */
function isXCookieDomain(domain: string): boolean {
  return domain === ".x.com" || domain === "x.com" || domain.endsWith(".x.com");
}

/**
 * X 完成判定（中转轮询用，纯函数供单测）：`.x.com` 域的 `auth_token` 与 `ct0`
 * 成对存在才算登录，返回规范串 `auth_token=…; ct0=…`；任一缺失返回 null——
 * ct0 缺失时 sanitizeXCookie 双值门槛也会拒，这里提前挡住，done 不误触发。
 * 多域同名（.x.com 与 .twitter.com 常并存同值）取 `.x.com` 域优先。
 */
export function pickXSession(cookies: CookieLike[]): string | null {
  const pick = (want: string): string | null => {
    let fallback: string | null = null;
    for (const cookie of cookies) {
      if (cookie.name.toLowerCase() !== want) continue;
      const value = cookie.value.trim();
      if (!value) continue;
      if (isXCookieDomain((cookie.domain ?? "").toLowerCase())) return value;
      if (fallback === null) fallback = value;
    }
    return fallback;
  };
  const authToken = pick("auth_token");
  const ct0 = pick("ct0");
  if (!authToken || !ct0) return null;
  return `auth_token=${authToken}; ct0=${ct0}`;
}

function parseCookieJson(text: string): BrowserSession {
  const start = text[0];
  if (start !== "[" && start !== "{") return { pixiv: "", fanbox: "" };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return pickSession(
        parsed.map((row) => {
          const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
          return {
            name: String(rec.name ?? rec.Name ?? ""),
            value: String(rec.value ?? rec.Value ?? ""),
            domain: String(rec.domain ?? rec.Domain ?? ""),
          };
        }),
      );
    }
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      return pickSession(
        Object.entries(rec).map(([name, value]) => ({
          name,
          value:
            typeof value === "string"
              ? value
              : String((value as { value?: unknown } | null)?.value ?? ""),
        })),
      );
    }
  } catch {
    /* not json */
  }
  return { pixiv: "", fanbox: "" };
}

/** Accepts PHPSESSID=…, Cookie-Editor JSON, Netscape cookies.txt, or a bare logged-in value. */
export function parseCookieDump(raw: string): BrowserSession {
  const text = raw.trim();
  if (!text) return { pixiv: "", fanbox: "" };

  const fromJson = parseCookieJson(text);
  if (fromJson.pixiv || fromJson.fanbox) return fromJson;

  let pixiv = "";
  let fanbox = "";

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tabs = trimmed.split("\t");
    if (tabs.length >= 7) {
      const picked = pickSession([{ name: tabs[5] ?? "", value: tabs[6] ?? "", domain: tabs[0] }]);
      pixiv = picked.pixiv || pixiv;
      fanbox = picked.fanbox || fanbox;
    }
  }

  const headerPixiv = text.match(/PHPSESSID=([^\s;]+)/i)?.[1];
  if (headerPixiv && isPixivLoggedInSession(headerPixiv)) pixiv = pixivSessionValue(headerPixiv);
  const headerFanbox = text.match(/FANBOXSESSID=([^\s;]+)/i)?.[1];
  if (headerFanbox && isFanboxLoggedInSession(headerFanbox)) fanbox = fanboxSessionValue(headerFanbox);

  if (!pixiv && isPixivLoggedInSession(text)) pixiv = pixivSessionValue(text);
  // 裸值只认 Pixiv：会话格式两站同形，裸值双填会让「粘一个框、另一个框跟着变」
  // （2026-09-14 拆框修复）。FANBOX 的裸值走 FANBOX 框的定向粘贴按站点解释。
  return { pixiv, fanbox };
}

export function canShowLoginWindow(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.GROK_AGENT || env.GROK_SESSION_ID || env.K_SERVICE) return false;
  if (platform === "win32" || platform === "darwin") return true;
  return Boolean(
    (env.DISPLAY?.trim() || env.WAYLAND_DISPLAY?.trim()) &&
      (env.XDG_CURRENT_DESKTOP?.trim() || env.DESKTOP_SESSION?.trim() || env.WAYLAND_DISPLAY?.trim()),
  );
}

export function chromeCandidates(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string[] {
  // R1 选择链首层：用户指定（KAMI_CHROME 最优先）→ Chrome → Edge（Windows 出厂
  // 自带，无 Chrome 机器的兜底）。headless-shell 属最末层，不进本表——由
  // orderLaunchCandidates 在合并 playwright 扫描结果后统一压到真浏览器之后。
  const extra = [env.KAMI_CHROME, env.CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  if (platform === "win32") {
    const pf = env.PROGRAMFILES ?? "C:\\Program Files";
    const pf86 = env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA ?? "";
    return [
      ...extra,
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : "",
      local ? `${local}\\Google\\Chrome Beta\\Application\\chrome.exe` : "",
      local ? `${local}\\Google\\Chrome SxS\\Application\\chrome.exe` : "",
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      local ? `${local}\\Microsoft\\Edge\\Application\\msedge.exe` : "",
    ].filter(Boolean);
  }
  if (platform === "darwin") {
    return [
      ...extra,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    ...extra,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];
}

/** headless-shell 二进制判定（纯函数供单测）：无头壳只能旧无头模式（"shell"）。 */
export function isHeadlessShellPath(path: string): boolean {
  return /headless-shell/i.test(path);
}

/**
 * R1 探测链排序（纯函数供单测）：真浏览器（Chrome / Edge / Chromium，含
 * playwright 的 Chrome for Testing）一律排在 headless-shell 之前，两层内部
 * 保持传入顺序（KAMI_CHROME 在 chromeCandidates 里本就是首项）。存在性由
 * exists 参数注入——生产传 existsSync，单测伪造「仅 Edge / 仅 Chrome /
 * 仅 headless-shell / 全有」布局（AC1）。playwright 目录里 headless-shell 与
 * 完整 Chrome 并存时同样按层分开，不再让壳抢先。
 */
export function orderLaunchCandidates(
  paths: string[],
  exists: (path: string) => boolean = () => true,
): string[] {
  const real: string[] = [];
  const shells: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    (isHeadlessShellPath(path) ? shells : real).push(path);
  }
  return [...real.filter(exists), ...shells.filter(exists)];
}

export type BrowserLaunchAttempt = {
  executablePath: string;
  /** puppeteer headless 形态：false 有头 / true 新无头 / "shell" 旧无头壳。 */
  headless: boolean | "shell";
  /** 无头降级时把 UA 的 Headless 字样抹掉（R2，只对 X 生效）。 */
  normalizeUa: boolean;
};

/**
 * R2 启动策略（纯函数供单测，AC2）：X 优先有头（真窗口，自建桌面部署可接受，
 * 消 HeadlessChrome 指纹触发的 Cloudflare 403），真浏览器全失败再按
 * 「无头真浏览器（UA 去 Headless）→ headless-shell」降级；pixiv / fanbox
 * 恒无头且不动 UA（现状回归锁）。headless-shell 二进制只能 "shell" 模式。
 */
export function launchAttemptsForSite(site: LoginSite, orderedPaths: string[]): BrowserLaunchAttempt[] {
  const real = orderedPaths.filter((path) => !isHeadlessShellPath(path));
  const shells = orderedPaths.filter(isHeadlessShellPath);
  if (site === "x") {
    return [
      ...real.map((executablePath) => ({ executablePath, headless: false as const, normalizeUa: false })),
      ...real.map((executablePath) => ({ executablePath, headless: true as const, normalizeUa: true })),
      ...shells.map((executablePath) => ({ executablePath, headless: "shell" as const, normalizeUa: true })),
    ];
  }
  return [
    ...real.map((executablePath) => ({ executablePath, headless: true as const, normalizeUa: false })),
    ...shells.map((executablePath) => ({ executablePath, headless: "shell" as const, normalizeUa: false })),
  ];
}

/**
 * R2 UA 规范化（纯函数供单测）：无头 UA 的 `HeadlessChrome/x.y` 换成
 * `Chrome/x.y`，其余原样。X 无头降级时在 page 层 set 到导航前。
 */
export function normalizeHeadlessUa(ua: string): string {
  return ua.replace(/HeadlessChrome/gi, "Chrome");
}

/**
 * R3 403 侦测（纯函数供单测，AC3）：只认 X 域（x.com / twitter.com 及子域）的
 * **Document** 响应且 status 恰为 403——Cloudflare 拦无头时登录文档本身就是
 * 403；404 / 500 / 子资源（Script、XHR 等）/ 他站一律不触发，防误报。
 */
export function isXRelayBlockedResponse(ev: {
  status?: number;
  type?: string;
  url?: string;
}): boolean {
  if (ev.status !== 403) return false;
  if (ev.type !== "Document") return false;
  const host = /^https?:\/\/([^/?#]+)/i.exec(ev.url ?? "")?.[1]?.toLowerCase();
  if (!host) return false;
  return (
    host === "x.com" ||
    host.endsWith(".x.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com")
  );
}
