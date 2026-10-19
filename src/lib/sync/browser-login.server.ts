/**
 * 登录中转（只在服务端跑）。
 *
 * 作用：用 Chrome / Edge 打开官方登录页，把画面和点击转到设置窗口，登完用 CDP 收 Cookie。
 *      浏览器选择链与按站启动策略（R1/R2）：KAMI_CHROME → Chrome → Edge → headless-shell
 *      （orderLaunchCandidates / launchAttemptsForSite）；X 有头优先——headless UA 的
 *      HeadlessChrome 字样会被 X/Cloudflare 拦（403），降级段用 normalizeHeadlessUa 抹掉。
 *      X 收到 Document 403 时转错误态并引导手贴 Cookie（X_RELAY_403_HINT，R3）。
 * 用法：HTTP `/api/login-browser` 调这里的 start/poll/input；不要在浏览器里 import。
 * 为什么：预览和 Docker 没有桌面，弹不出 Chrome；页面 JS 又读不到 HttpOnly Cookie。
 *        FANBOX 要等到跳过 /auth/start 且会话变成 `用户ID_令牌` 才收工；
 *        X 等 `.x.com` 域 auth_token+ct0 成对出现（pickXSession），无访客歧义。
 *        relayToken（10-18 凭据竞态修复）：start 受理时签发、仅随 start 响应
 *        外发一次；帧/凭据/输入/取消全要过 assertRelayToken——见下方模块变量注释。
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  FANBOX_AUTH_START,
  FANBOX_LOGIN_URL,
  LOGIN_VIEW,
  PIXIV_LOGIN_URL,
  X_LOGIN_URL,
  X_RELAY_403_HINT,
  chromeCandidates,
  isXRelayBlockedResponse,
  launchAttemptsForSite,
  loginJobBusy,
  normalizeHeadlessUa,
  orderLaunchCandidates,
  pickSession,
  pickXSession,
  type LoginInputEvent,
  type LoginJobSnapshot,
  type LoginSite,
} from "./browser-login.ts";
import { getActiveProxy } from "../proxy.server.ts";
import { parseProxyUrl } from "../proxy-url.ts";
import { outboundFetch } from "../curl-fetch.server.ts";
import { parseFanboxMe, parsePixivMe, type SiteProfile } from "../site-identity.ts";
import { resolveIdentities } from "../site-identity.server.ts";
import { X_WEB_BEARER } from "../upstream/x.ts";
import { getLogger } from "../log.server.ts";

const log = {
  listProfiles: getLogger("browser-login:list-profiles"),
  kami: getLogger("kami"),
  pixivMe: getLogger("browser-login:pixiv-me"),
  fanboxMe: getLogger("browser-login:fanbox-me"),
  xMe: getLogger("browser-login:x-me"),
  openPixiv: getLogger("browser-login:open-pixiv"),
  resolveIdentity: getLogger("browser-login:resolve-identity"),
  warmPixiv: getLogger("browser-login:warm-pixiv"),
  warmFanbox: getLogger("browser-login:warm-fanbox"),
};

type MouseButton = "left" | "right" | "middle";

type PageLike = {
  authenticate: (c: { username: string; password: string }) => Promise<void>;
  goto: (url: string, opts?: { waitUntil?: "domcontentloaded"; timeout?: number }) => Promise<unknown>;
  createCDPSession: () => Promise<CdpSession>;
  bringToFront: () => Promise<void>;
  url: () => string;
  content: () => Promise<string>;
  evaluate: (pageFunction: () => unknown) => Promise<unknown>;
  setViewport: (v: { width: number; height: number; deviceScaleFactor?: number }) => Promise<void>;
  /** R2 无头降级时的 UA 规范化（仅 X 用；可选——测试替身可不实现）。 */
  setUserAgent?: (ua: string) => Promise<void>;
  screenshot: (opts: { type: "jpeg"; quality: number; encoding: "base64" }) => Promise<string>;
  mouse: {
    move: (x: number, y: number) => Promise<void>;
    down: (opts?: { button?: MouseButton }) => Promise<void>;
    up: (opts?: { button?: MouseButton }) => Promise<void>;
    wheel: (opts: { deltaX?: number; deltaY?: number }) => Promise<void>;
  };
  keyboard: {
    down: (key: string) => Promise<void>;
    up: (key: string) => Promise<void>;
    sendCharacter: (text: string) => Promise<void>;
  };
};

type CdpSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** 监听器载荷随事件各异（screencast 帧 / Network.responseReceived）：参数位取
   *  never（反变）——任何具体事件载荷的监听器都可安装，实参形态由各监听点自负。 */
  on: (event: string, listener: (params: never) => void) => void;
  off?: (event: string, listener: (params: never) => void) => void;
};

type ScreencastFrame = {
  data: string;
  sessionId: number;
  metadata?: { deviceWidth?: number; deviceHeight?: number };
};

/** CDP Network.responseReceived 事件里我们关心的两个字段（R3 403 侦测）。 */
type CdpResponseReceived = {
  type?: string;
  response?: { url?: string; status?: number };
};

type BrowserLike = {
  connected?: boolean;
  close: () => Promise<void>;
  pages: () => Promise<PageLike[]>;
  newPage: () => Promise<PageLike>;
  /** R2 UA 规范化用（可选——测试替身可不实现）。 */
  userAgent?: () => Promise<string>;
};

const idleJob = (): LoginJobSnapshot => ({
  status: "idle",
  site: null,
  error: null,
  chrome: null,
  relay: true,
  pageUrl: "",
  viewWidth: LOGIN_VIEW.width,
  viewHeight: LOGIN_VIEW.height,
  frame: null,
  pixiv: "",
  fanbox: "",
  x: "",
  pixivProfile: null,
  fanboxProfile: null,
});

let job: LoginJobSnapshot = idleJob();
let stop = false;
let closer: (() => Promise<void>) | null = null;
let activePage: PageLike | null = null;
let activeCdp: CdpSession | null = null;

/**
 * per-job relayToken（10-18 凭据竞态修复）：start 受理时签发（randomBytes(32)
 * hex，256bit），仅随 start 响应外发一次；此后帧轮询 / ?credentials=1 /
 * input / cancel 一律先过 assertRelayToken，缺失或不符即 401（无任何副作用）。
 *
 * **红线：绝不放进 LoginJobSnapshot。** 快照随每次轮询响应整体展开返回，进了
 * 快照等于把 token 广播给每个旁观者，修复直接失效（design 关键点）。模块级
 * 单变量与 job 单例同生命周期，语义等价且无泄漏面。终态复位全覆盖：
 * done 消费（consumeLoginJobCredentials）/ error（runJob 两处 catch 与
 * startBrowserLogin 的 runJob.catch）/ cancelBrowserLogin / 下一次 start 覆写。
 */
let relayToken = "";

/**
 * relayToken 校验（timingSafeEqual；长度不等先 false——hex 64 恒定长，长度
 * 信息不泄 token）。无 token（未 start / 已终态复位）对一切输入返回 false：
 * 401 优先于 consume / dispatch / 帧返回等任何副作用。
 */
export function assertRelayToken(provided: string | null): boolean {
  if (!relayToken || !provided) return false;
  const expected = Buffer.from(relayToken, "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * 仅测试用：直接安装 job 快照与 relayToken（绕过 Chrome 启动），路由/服务端单测的状态植入器。
 * 生产守卫（10-18 P2）：植入器能直接操纵中转状态机（含 relayToken），生产构建
 * 里一旦可达等于给任意调用方一把万能钥匙——NODE_ENV=production 一律抛错，
 * 判定取调用时 env（非模块加载时），单测注入生产值即可覆盖守卫分支。
 */
export function installLoginJobForTest(snapshot: LoginJobSnapshot, token = ""): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("installLoginJobForTest 仅测试可用：生产环境禁止植入中转状态");
  }
  job = { ...snapshot };
  relayToken = token;
}

/**
 * startBrowserLogin 的返回形状：snapshot 永不含 token（红线），token 单独
 * 携带、由路由只拼进 start 响应这一次。同站重入（busy 同 site）时 token
 * 为空串——已有 job 的 token 不重复外发给第二个调用方。
 */
export type StartLoginResult = { snapshot: LoginJobSnapshot; relayToken: string };

export function getLoginJob(includeFrame = false): LoginJobSnapshot {
  if (includeFrame) return { ...job };
  return { ...job, frame: job.frame ? "*" : null };
}

/**
 * 取走登录会话串并立即从内存清空（SEC-02：done 后凭据只交出一次，
 * 之后任何过闸客户端都拿不到 —— 直至下一次 start）。x 与两站同语义。
 * 同时清空 relayToken：凭据一旦交出，本 job 的中转交互全部失效。
 */
export function consumeLoginJobCredentials(): LoginJobSnapshot {
  const snap = { ...job, frame: null };
  relayToken = "";
  if (job.pixiv || job.fanbox || job.x) {
    job = { ...job, pixiv: "", fanbox: "", x: "" };
  }
  return snap;
}

function proxyArgs(): { args: string[]; user?: string; password?: string } {
  const raw = getActiveProxy();
  if (!raw) return { args: [] };
  const parsed = parseProxyUrl(raw);
  if (!parsed.ok || !parsed.href) return { args: [] };
  const url = new URL(parsed.href);
  const server = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  return {
    args: [`--proxy-server=${server}`],
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

function playwrightChromeBins(): string[] {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", join(homedir(), ".cache/ms-playwright")];
  const found: string[] = [];
  for (const root of roots) {
    // Chrome 探测路径运行时才定（env/homedir），静态分析无法定界——turbopackIgnore 防整仓被追踪。
    if (!root || !existsSync(/*turbopackIgnore: true*/ root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(/*turbopackIgnore: true*/ root);
    } catch (err) {
      log.listProfiles.warn("目录不可读（跳过）：", err instanceof Error ? err.message : err);
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().includes("chrom")) continue;
      const dir = join(/*turbopackIgnore: true*/ root, name);
      const shells = [
        join(dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(dir, "chrome-linux64", "chrome"),
        join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
        join(dir, "chrome-win64", "chrome.exe"),
        join(dir, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(dir, "chrome-mac-x64", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
      ];
      for (const bin of shells) {
        if (existsSync(/*turbopackIgnore: true*/ bin)) found.push(bin);
      }
    }
  }
  return found;
}

type LaunchOutcome = {
  browser: BrowserLike;
  chrome: string;
  proxy: ReturnType<typeof proxyArgs>;
  headless: boolean | "shell";
  normalizeUa: boolean;
};

/**
 * R2 channel 兜底（Chrome 装在非标准位置时让 puppeteer 自己找）：与路径层
 * 同策略——X 有头优先再无头（无头段 UA 规范化），其余站恒无头。
 */
type ChannelAttempt = {
  channel: "chrome" | "chrome-beta" | "chrome-dev";
  headless: boolean | "shell";
  normalizeUa: boolean;
};

function channelAttempts(site: LoginSite): ChannelAttempt[] {
  const names = ["chrome", "chrome-beta", "chrome-dev"] as const;
  if (site === "x") {
    return [
      ...names.map((channel) => ({ channel, headless: false as const, normalizeUa: false })),
      ...names.map((channel) => ({ channel, headless: true as const, normalizeUa: true })),
    ];
  }
  return names.map((channel) => ({ channel, headless: true as const, normalizeUa: false }));
}

async function launchChrome(profile: string, site: LoginSite): Promise<LaunchOutcome> {
  const { default: puppeteer } = await import("puppeteer-core");
  const proxy = proxyArgs();
  // R1：标准位置候选 + playwright 下载的构建（含 Chrome for Testing 与
  // headless-shell）合并去重后，真浏览器一律压到 headless-shell 之前。
  const bins = [...new Set([...chromeCandidates(), ...playwrightChromeBins()].filter(Boolean))];
  const ordered = orderLaunchCandidates(bins, (path) => existsSync(/*turbopackIgnore: true*/ path));
  const attempts = launchAttemptsForSite(site, ordered);

  const tried: string[] = [];
  for (const attempt of attempts) {
    tried.push(attempt.executablePath);
    const common = {
      headless: attempt.headless,
      userDataDir: profile,
      defaultViewport: { width: LOGIN_VIEW.width, height: LOGIN_VIEW.height, deviceScaleFactor: 1 },
      ignoreDefaultArgs: ["--enable-automation"],
      timeout: 60_000,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--hide-scrollbars",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        `--window-size=${LOGIN_VIEW.width},${LOGIN_VIEW.height}`,
        ...proxy.args,
      ],
    };
    try {
      const browser = (await puppeteer.launch({
        ...common,
        executablePath: attempt.executablePath,
      })) as unknown as BrowserLike;
      return {
        browser,
        chrome: attempt.executablePath,
        proxy,
        headless: attempt.headless,
        normalizeUa: attempt.normalizeUa,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.kami.warn(`无法启动 ${attempt.executablePath}: ${message}`);
    }
  }

  for (const attempt of channelAttempts(site)) {
    tried.push(`channel:${attempt.channel}`);
    try {
      const browser = (await puppeteer.launch({
        headless: attempt.headless,
        userDataDir: profile,
        defaultViewport: { width: LOGIN_VIEW.width, height: LOGIN_VIEW.height, deviceScaleFactor: 1 },
        ignoreDefaultArgs: ["--enable-automation"],
        timeout: 60_000,
        channel: attempt.channel,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          ...proxy.args,
        ],
      })) as unknown as BrowserLike;
      return {
        browser,
        chrome: attempt.channel,
        proxy,
        headless: attempt.headless,
        normalizeUa: attempt.normalizeUa,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.kami.warn(`无法启动 channel:${attempt.channel}: ${message}`);
    }
  }

  throw new Error(
    `找不到可用的 Chrome。${tried.length ? `已尝试：${tried.join("、")}。` : ""}安装 Chrome / Edge，或设置 KAMI_CHROME。也可以把手贴 Cookie 粘进设置。`,
  );
}

function isPixivLoginUrl(url: string): boolean {
  return /accounts\.pixiv\.net/i.test(url) || /pixiv\.net\/login/i.test(url);
}

async function readRawCookies(page: PageLike): Promise<{ name: string; value: string; domain?: string }[]> {
  const cdp = activeCdp ?? (await page.createCDPSession());
  const all = (await cdp.send("Network.getAllCookies")) as {
    cookies?: { name: string; value: string; domain?: string }[];
  };
  return all.cookies ?? [];
}

async function readCookies(page: PageLike): Promise<ReturnType<typeof pickSession>> {
  return pickSession(await readRawCookies(page));
}

/**
 * X 身份 best-effort：带登录 Cookie + csrf（=ct0）+ 公共 web bearer 调 legacy
 * verify_credentials（research §9 之外的 1.1 端点，可用性未证）。出站走项目
 * 通道 outboundFetch（10-18 P2：与中转 Chrome 同代理，代理环境不再泄真实出口
 * IP；有代理时 undici 池连接复用，done 不再被慢握手拖住）。非 2xx / 异常
 * 一律静默 null——失败只少一行日志，绝不阻塞 done（身份展示不在主链上）；
 * 8s AbortSignal 语义保留（init.signal 优先于 outboundFetch 的 45s 兜底）。
 */
async function fetchXIdentity(session: string): Promise<{ name: string; screenName: string } | null> {
  const ct0 = /(?:^|;\s*)ct0=([^;\s]+)/i.exec(session)?.[1];
  if (!ct0) return null;
  const res = await outboundFetch("https://api.x.com/1.1/account/verify_credentials.json", {
    headers: {
      Authorization: `Bearer ${X_WEB_BEARER}`,
      Cookie: session,
      "x-csrf-token": ct0,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { screen_name?: unknown; name?: unknown };
  const screenName = typeof data.screen_name === "string" ? data.screen_name : "";
  const name = typeof data.name === "string" ? data.name : "";
  return screenName ? { name, screenName } : null;
}

async function profileFromPixivPage(page: PageLike): Promise<SiteProfile | null> {
  try {
    const url = page.url();
    if (isPixivLoginUrl(url)) return null;
    const html = await page.content();
    const fromHtml = parsePixivMe({}, html);
    if (fromHtml?.id && fromHtml.name) return fromHtml;
    const json = await page.evaluate(async () => {
      const res = await fetch("https://www.pixiv.net/touch/ajax/user/self/status", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return res.json();
    });
    return parsePixivMe(json);
  } catch (err) {
    log.pixivMe.warn("身份探测失败（按未登录）：", err instanceof Error ? err.message : err);
    return null;
  }
}

async function profileFromFanboxPage(page: PageLike): Promise<SiteProfile | null> {
  try {
    const html = await page.content();
    const fromHtml = parseFanboxMe({}, html);
    if (fromHtml?.id && fromHtml.name) return fromHtml;
    const json = await page.evaluate(async () => {
      const res = await fetch("https://api.fanbox.cc/user.info", {
        credentials: "include",
        headers: { Accept: "application/json", Origin: "https://www.fanbox.cc" },
      });
      return res.json();
    });
    return parseFanboxMe(json);
  } catch (err) {
    log.fanboxMe.warn("身份探测失败（按未登录）：", err instanceof Error ? err.message : err);
    return null;
  }
}

async function confirmPixivLogin(page: PageLike, pixiv: string): Promise<SiteProfile | null> {
  if (isPixivLoginUrl(page.url())) {
    try {
      await page.goto("https://www.pixiv.net/", { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch (err) {
      log.openPixiv.warn("打开 Pixiv 失败：", err instanceof Error ? err.message : err);
      return null;
    }
  }
  const fromPage = await profileFromPixivPage(page);
  if (fromPage) return fromPage;
  try {
    const remote = await resolveIdentities({ pixiv, fanbox: "" });
    return remote.pixiv;
  } catch (err) {
    log.resolveIdentity.warn("远端身份解析失败：", err instanceof Error ? err.message : err);
    return null;
  }
}

async function startScreencast(page: PageLike): Promise<void> {
  const cdp = await page.createCDPSession();
  activeCdp = cdp;
  const onFrame = (ev: ScreencastFrame) => {
    job = {
      ...job,
      frame: ev.data,
      viewWidth: ev.metadata?.deviceWidth || job.viewWidth,
      viewHeight: ev.metadata?.deviceHeight || job.viewHeight,
      pageUrl: page.url() || job.pageUrl,
    };
    void cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => undefined);
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 52,
    maxWidth: LOGIN_VIEW.width,
    maxHeight: LOGIN_VIEW.height,
    everyNthFrame: 1,
  });
}

function mouseButton(button?: number): MouseButton {
  if (button === 2) return "right";
  if (button === 1) return "middle";
  return "left";
}

export async function dispatchLoginInput(event: LoginInputEvent): Promise<LoginJobSnapshot> {
  const page = activePage;
  if (!page || !loginJobBusy(job.status)) {
    throw new Error("没有进行中的登录窗口");
  }
  if (event.type === "mouse") {
    const x = clamp(event.x, 0, job.viewWidth);
    const y = clamp(event.y, 0, job.viewHeight);
    if (event.action === "moved" || event.action === "pressed" || event.action === "released") {
      await page.mouse.move(x, y);
    }
    if (event.action === "pressed") await page.mouse.down({ button: mouseButton(event.button) });
    if (event.action === "released") await page.mouse.up({ button: mouseButton(event.button) });
    if (event.action === "wheel") await page.mouse.wheel({ deltaX: event.deltaX ?? 0, deltaY: event.deltaY ?? 0 });
  } else if (event.type === "key") {
    const key = event.key;
    if (!key || key === "Process" || key === "Dead" || key === "Unidentified") return getLoginJob();
    try {
      if (event.action === "down") await page.keyboard.down(key);
      if (event.action === "up") await page.keyboard.up(key);
    } catch {
      /* puppeteer rejects unknown KeyInput names */
    }
  } else if (event.type === "text") {
    if (event.text) {
      try {
        const cdp = activeCdp;
        if (cdp) await cdp.send("Input.insertText", { text: event.text });
        else await page.keyboard.sendCharacter(event.text);
      } catch {
        /* ignore */
      }
    }
  }
  return getLoginJob();
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

async function grabFrame(page: PageLike): Promise<void> {
  try {
    const data = await page.screenshot({ type: "jpeg", quality: 48, encoding: "base64" });
    if (typeof data === "string" && data) {
      job = { ...job, frame: data, pageUrl: page.url() || job.pageUrl };
    }
  } catch {
    /* ignore */
  }
}

async function runJob(site: LoginSite): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "kami-login-"));
  let browser: BrowserLike | undefined;
  try {
    const launched = await launchChrome(profile, site);
    if (stop) throw new Error("已取消登录窗口");
    browser = launched.browser;
    closer = async () => {
      try {
        await browser?.close();
      } catch {
        /* already closed */
      }
    };
    job = {
      ...job,
      status: "waiting",
      chrome: launched.chrome,
      relay: true,
      error: null,
      pageUrl: "",
    };
    const modeLabel =
      launched.headless === false ? "有头" : launched.headless === "shell" ? "无头壳" : "无头";
    log.kami.info(
      `登录中转已启动: ${launched.chrome}（${modeLabel}${launched.normalizeUa ? "，UA 已去 Headless" : ""}）`,
    );

    const page = (await browser.pages())[0] ?? (await browser.newPage());
    activePage = page;
    try {
      await page.setViewport({ width: LOGIN_VIEW.width, height: LOGIN_VIEW.height, deviceScaleFactor: 1 });
    } catch {
      /* headless-shell may already have the viewport */
    }
    if (launched.proxy.user) {
      await page.authenticate({ username: launched.proxy.user, password: launched.proxy.password ?? "" });
    }
    // R2 无头降级的 UA 规范化（仅 X）：真 UA 抹掉 HeadlessChrome 字样后在导航前
    // set 到 page 层。best-effort——拿不到/设不上不阻塞中转（有头本就不用改）。
    if (launched.normalizeUa) {
      try {
        const rawUa = (await browser.userAgent?.()) ?? "";
        const normalized = normalizeHeadlessUa(rawUa);
        if (rawUa && normalized !== rawUa) await page.setUserAgent?.(normalized);
      } catch (err) {
        log.kami.warn("UA 规范化失败（继续中转）：", err instanceof Error ? err.message : err);
      }
    }
    await startScreencast(page);

    // R3 X 403 侦测：在既有 screencast CDP 会话上挂 Network.responseReceived，
    // 只认 X 域 Document 403（isXRelayBlockedResponse 纯函数有单测锁，404/500/
    // 子资源不触发）。命中后轮询循环转错误态并给手贴 Cookie 引导，不静默。
    let xBlocked403 = false;
    if (site === "x" && activeCdp) {
      const watch = activeCdp;
      try {
        await watch.send("Network.enable");
        watch.on("Network.responseReceived", (ev) => {
          const rec = ev as CdpResponseReceived;
          if (
            isXRelayBlockedResponse({
              status: rec.response?.status,
              type: rec.type,
              url: rec.response?.url,
            })
          ) {
            xBlocked403 = true;
          }
        });
      } catch (err) {
        log.kami.warn("403 侦测挂载失败（继续中转）：", err instanceof Error ? err.message : err);
      }
    }

    const start =
      site === "fanbox" ? FANBOX_LOGIN_URL : site === "x" ? X_LOGIN_URL : PIXIV_LOGIN_URL;
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 45_000 });
    job = { ...job, pageUrl: page.url() };
    if (!job.frame) await grabFrame(page);

    const deadline = Date.now() + 4 * 60 * 1000;
    let pixiv = "";
    let fanbox = "";
    let x = "";
    let pixivProfile: SiteProfile | null = null;
    let fanboxProfile: SiteProfile | null = null;
    let pixivConfirmed = false;
    let openedPixivHome = false;
    let openedFanboxAuth = false;
    let pixivSeenAt = 0;
    let fanboxBounceAt = 0;
    let fanboxDone = false;
    let lastShot = 0;
    while (Date.now() < deadline && !stop) {
      const alive = typeof browser.connected === "boolean" ? browser.connected : true;
      if (!alive) throw new Error("登录窗口已关闭");
      job = { ...job, pageUrl: page.url() || job.pageUrl };
      if (!job.frame || Date.now() - lastShot > 1200) {
        await grabFrame(page);
        lastShot = Date.now();
      }
      const rawCookies = await readRawCookies(page);
      const picked = pickSession(rawCookies);
      pixiv = picked.pixiv || pixiv;
      fanbox = picked.fanbox || fanbox;

      // X：auth_token+ct0 成对出现即收工（pickXSession 内已含 .x.com 域优先与
      // 双值门槛）；不做任何访客/回转判定，也不触碰下面两站的确认流程。
      // 403（R3）：登录页被拒时尽快转错误态给手贴 Cookie 引导，不再空等超时。
      if (site === "x") {
        x = pickXSession(rawCookies) ?? x;
        if (x) break;
        if (xBlocked403) throw new Error(X_RELAY_403_HINT);
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }

      if (site === "pixiv" && pixiv && !pixivConfirmed) {
        if (!pixivSeenAt) pixivSeenAt = Date.now();
        if (!openedPixivHome && isPixivLoginUrl(page.url())) {
          openedPixivHome = true;
          try {
            await page.goto("https://www.pixiv.net/", { waitUntil: "domcontentloaded", timeout: 20_000 });
          } catch (err) {
            log.warmPixiv.warn("预热 Pixiv 失败：", err instanceof Error ? err.message : err);
            openedPixivHome = false;
          }
        }
        pixivProfile = (await profileFromPixivPage(page)) ?? pixivProfile;
        if (!pixivProfile) pixivProfile = await confirmPixivLogin(page, pixiv);
        if (pixivProfile?.id || Date.now() - pixivSeenAt > 8_000) pixivConfirmed = true;
      }

      if (site === "fanbox" && pixiv && !pixivConfirmed) {
        pixivConfirmed = true;
      }

      // 两站独立（2026-09-14 拆框）：只有 FANBOX 登录才走 /auth/start 回转收割
      // FANBOXSESSID；Pixiv 登录到此为止，FANBOX 访问由请求层 fanboxCookieHeader
      // 的 pixiv 回退承担，不在登录结果里复制值。
      const readyForFanbox = site === "fanbox" && Boolean(pixiv || fanbox);
      if (readyForFanbox && !fanboxDone && !openedFanboxAuth) {
        openedFanboxAuth = true;
        fanboxBounceAt = Date.now();
        try {
          await page.goto(FANBOX_AUTH_START, { waitUntil: "domcontentloaded", timeout: 25_000 });
        } catch (err) {
          log.warmFanbox.warn("打开 FANBOX 授权页失败：", err instanceof Error ? err.message : err);
          openedFanboxAuth = false;
        }
      }

      if (openedFanboxAuth && !fanboxDone) {
        const after = await readCookies(page);
        pixiv = after.pixiv || pixiv;
        fanbox = after.fanbox || fanbox;
        if (!fanbox && pixiv) fanbox = pixiv;
        if (fanbox && !fanboxProfile) {
          fanboxProfile = (await profileFromFanboxPage(page)) ?? fanboxProfile;
        }
        if (fanbox && (fanboxProfile?.id || Date.now() - fanboxBounceAt > 8_000)) fanboxDone = true;
        if (!fanbox && Date.now() - fanboxBounceAt > 12_000) {
          if (pixiv) fanbox = pixiv;
          fanboxDone = true;
        }
      }

      if (site === "pixiv" && pixivConfirmed) break;
      if (site === "fanbox" && fanbox && fanboxDone) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (stop) throw new Error("已取消登录窗口");
    if (site === "pixiv" && !pixiv) {
      throw new Error("超时未检测到 Pixiv 登录。请在窗口里完成登录（访客 Cookie 不算），或改用手贴。");
    }
    if (site === "fanbox" && !fanbox) {
      throw new Error("超时未检测到 FANBOX 登录。请从官方账号选择页登入，完成 /auth/start 回转后再等一下。");
    }
    if (site === "x" && !x) {
      // 403 已命中但 deadline 先到（竞态兜底）：同样给手贴 Cookie 引导。
      throw new Error(
        xBlocked403 ? X_RELAY_403_HINT : "超时未检测到 X 登录。请在窗口里完成登录（含可能的验证码 / 2FA），或改用手贴。",
      );
    }
    // 拆框：Pixiv 登录只交付 pixiv（含身份解析也只解析 pixiv），fanbox 一律不带出；
    // X 同理只交付 x——两站凭据与身份不跨站复制。
    if (site === "pixiv") fanbox = "";
    if (site === "x") {
      pixiv = "";
      fanbox = "";
    }
    if (site === "x") {
      // best-effort 身份：失败/超时静默跳过，不影响 done（身份只进日志）
      try {
        const me = await fetchXIdentity(x);
        if (me) log.xMe.info(`X 登录身份：${me.name ? `${me.name} ` : ""}@${me.screenName}`);
      } catch (err) {
        log.xMe.warn("X 身份探测失败（best-effort，跳过）：", err instanceof Error ? err.message : err);
      }
    }
    if ((pixiv && !pixivProfile) || (fanbox && !fanboxProfile)) {
      try {
        const profiles = await resolveIdentities({ pixiv, fanbox });
        pixivProfile = pixivProfile ?? profiles.pixiv;
        fanboxProfile = fanboxProfile ?? profiles.fanbox;
      } catch {
        /* logged-in cookie is enough */
      }
    }
    job = {
      ...job,
      status: "done",
      error: null,
      pixiv,
      fanbox,
      x,
      pixivProfile,
      fanboxProfile,
      frame: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    if (/Cannot find module 'puppeteer-core'/.test(message)) {
      relayToken = "";
      job = { ...job, status: "error", error: "缺少 puppeteer-core。请在项目目录执行 pnpm i 后再试。", frame: null };
    } else {
      relayToken = "";
      job = { ...job, status: "error", error: message };
    }
  } finally {
    closer = null;
    activePage = null;
    activeCdp = null;
    try {
      await browser?.close();
    } catch {
      /* already closed */
    }
    rmSync(profile, { recursive: true, force: true });
  }
}

export async function startBrowserLogin(site: LoginSite): Promise<StartLoginResult> {
  if (loginJobBusy(job.status)) {
    // 同站重入：返回现状快照但不外发 token——token 只属于最初受理 start 的那一方，
    // 否则第二个调用方（如抢跑的旁观者）就能拿到钥匙看帧/取凭据。
    if (job.site === site) return { snapshot: getLoginJob(), relayToken: "" };
    throw new Error("已有登录窗口在进行，先完成或关掉那一个。");
  }
  stop = false;
  job = { ...idleJob(), status: "launching", site, relay: true };
  // 受理即签发（覆写上一 job 残留）；launching 期间失败会走 error 复位 → 空串照实外发。
  relayToken = randomBytes(32).toString("hex");
  void runJob(site).catch((err) => {
    const message = err instanceof Error ? err.message : "登录失败";
    if (loginJobBusy(job.status) || job.status === "launching") {
      relayToken = "";
      job = { ...job, status: "error", error: message };
    }
  });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && job.status === "launching") {
    await new Promise((r) => setTimeout(r, 150));
  }
  // token 仅在此处随返回值外发一次（路由拼进 start 响应）；取的是当前值——
  // 等待期间若已被取消/出错复位，拿到的是空串而不是过期钥匙。
  return { snapshot: getLoginJob(), relayToken };
}

export async function cancelBrowserLogin(): Promise<LoginJobSnapshot> {
  stop = true;
  // 无条件清空：cancel 即终结本 job 的全部中转交互（含 done 未取凭据的残留会话）。
  relayToken = "";
  try {
    await closer?.();
  } catch {
    /* ignore */
  }
  if (loginJobBusy(job.status)) {
    job = { ...job, status: "error", error: "已取消登录窗口", frame: null };
  }
  activePage = null;
  activeCdp = null;
  return getLoginJob();
}
