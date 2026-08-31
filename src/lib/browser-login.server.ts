/**
 * 登录中转（只在服务端跑）。
 *
 * 作用：用无头 Chrome 打开官方登录页，把画面和点击转到设置窗口，登完用 CDP 收 Cookie。
 * 用法：HTTP `/api/login-browser` 调这里的 start/poll/input；不要在浏览器里 import。
 * 为什么：预览和 Docker 没有桌面，弹不出 Chrome；页面 JS 又读不到 HttpOnly Cookie。
 *        FANBOX 要等到跳过 /auth/start 且会话变成 `用户ID_令牌` 才收工。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  FANBOX_AUTH_START,
  FANBOX_LOGIN_URL,
  LOGIN_VIEW,
  PIXIV_LOGIN_URL,
  chromeCandidates,
  loginJobBusy,
  pickSession,
  type LoginInputEvent,
  type LoginJobSnapshot,
  type LoginSite,
} from "./browser-login";
import { getActiveProxy } from "./proxy.server";
import { parseProxyUrl } from "./proxy-url";
import { parseFanboxMe, parsePixivMe, type SiteProfile } from "./site-identity";
import { resolveIdentities } from "./site-identity.server";

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
  on: (event: string, listener: (params: ScreencastFrame) => void) => void;
  off?: (event: string, listener: (params: ScreencastFrame) => void) => void;
};

type ScreencastFrame = {
  data: string;
  sessionId: number;
  metadata?: { deviceWidth?: number; deviceHeight?: number };
};

type BrowserLike = {
  connected?: boolean;
  close: () => Promise<void>;
  pages: () => Promise<PageLike[]>;
  newPage: () => Promise<PageLike>;
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
  pixivProfile: null,
  fanboxProfile: null,
});

let job: LoginJobSnapshot = idleJob();
let stop = false;
let closer: (() => Promise<void>) | null = null;
let activePage: PageLike | null = null;
let activeCdp: CdpSession | null = null;

export function getLoginJob(includeFrame = false): LoginJobSnapshot {
  if (includeFrame) return { ...job };
  return { ...job, frame: job.frame ? "*" : null };
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
    if (!root || !existsSync(root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().includes("chrom")) continue;
      const dir = join(root, name);
      const shells = [
        join(dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(dir, "chrome-linux64", "chrome"),
        join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
        join(dir, "chrome-win64", "chrome.exe"),
        join(dir, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(dir, "chrome-mac-x64", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
      ];
      for (const bin of shells) {
        if (existsSync(bin)) found.push(bin);
      }
    }
  }
  return found;
}

function isHeadlessShell(path: string): boolean {
  return /headless-shell/i.test(path);
}

async function launchChrome(profile: string): Promise<{ browser: BrowserLike; chrome: string; proxy: ReturnType<typeof proxyArgs> }> {
  const { default: puppeteer } = await import("puppeteer-core");
  const proxy = proxyArgs();
  const bins = [...chromeCandidates(), ...playwrightChromeBins()];
  const unique = [...new Set(bins.filter(Boolean))];

  const tried: string[] = [];
  for (const executablePath of unique) {
    if (!executablePath || !existsSync(executablePath)) continue;
    tried.push(executablePath);
    const headless = true;
    const common = {
      headless,
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
      const browser = (await puppeteer.launch({ ...common, executablePath })) as unknown as BrowserLike;
      return { browser, chrome: executablePath, proxy };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[kami] 无法启动 ${executablePath}: ${message}`);
    }
  }

  for (const channel of ["chrome", "chrome-beta", "chrome-dev"] as const) {
    tried.push(`channel:${channel}`);
    try {
      const browser = (await puppeteer.launch({
        headless: true,
        userDataDir: profile,
        defaultViewport: { width: LOGIN_VIEW.width, height: LOGIN_VIEW.height, deviceScaleFactor: 1 },
        ignoreDefaultArgs: ["--enable-automation"],
        timeout: 60_000,
        channel,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          ...proxy.args,
        ],
      })) as unknown as BrowserLike;
      return { browser, chrome: channel, proxy };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[kami] 无法启动 channel:${channel}: ${message}`);
    }
  }

  throw new Error(
    `找不到可用的 Chrome。${tried.length ? `已尝试：${tried.join("、")}。` : ""}安装 Chrome / Edge，或设置 KAMI_CHROME。也可以把手贴 Cookie 粘进设置。`,
  );
}

function isPixivLoginUrl(url: string): boolean {
  return /accounts\.pixiv\.net/i.test(url) || /pixiv\.net\/login/i.test(url);
}

async function readCookies(page: PageLike): Promise<ReturnType<typeof pickSession>> {
  const cdp = activeCdp ?? (await page.createCDPSession());
  const all = (await cdp.send("Network.getAllCookies")) as {
    cookies?: { name: string; value: string; domain?: string }[];
  };
  return pickSession(all.cookies ?? []);
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
  } catch {
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
  } catch {
    return null;
  }
}

async function confirmPixivLogin(page: PageLike, pixiv: string): Promise<SiteProfile | null> {
  if (isPixivLoginUrl(page.url())) {
    try {
      await page.goto("https://www.pixiv.net/", { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      return null;
    }
  }
  const fromPage = await profileFromPixivPage(page);
  if (fromPage) return fromPage;
  try {
    const remote = await resolveIdentities({ pixiv, fanbox: "" });
    return remote.pixiv;
  } catch {
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
    const launched = await launchChrome(profile);
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
    console.info(`[kami] 登录中转已启动: ${launched.chrome}${isHeadlessShell(launched.chrome) ? " (headless)" : ""}`);

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
    await startScreencast(page);

    const start = site === "fanbox" ? FANBOX_LOGIN_URL : PIXIV_LOGIN_URL;
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 45_000 });
    job = { ...job, pageUrl: page.url() };
    if (!job.frame) await grabFrame(page);

    const deadline = Date.now() + 4 * 60 * 1000;
    let pixiv = "";
    let fanbox = "";
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
      const picked = await readCookies(page);
      pixiv = picked.pixiv || pixiv;
      fanbox = picked.fanbox || fanbox;

      if (site === "pixiv" && pixiv && !pixivConfirmed) {
        if (!pixivSeenAt) pixivSeenAt = Date.now();
        if (!openedPixivHome && isPixivLoginUrl(page.url())) {
          openedPixivHome = true;
          try {
            await page.goto("https://www.pixiv.net/", { waitUntil: "domcontentloaded", timeout: 20_000 });
          } catch {
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

      const readyForFanbox = site === "fanbox" ? Boolean(pixiv || fanbox) : pixivConfirmed;
      if (readyForFanbox && !fanboxDone && !openedFanboxAuth) {
        openedFanboxAuth = true;
        fanboxBounceAt = Date.now();
        try {
          await page.goto(FANBOX_AUTH_START, { waitUntil: "domcontentloaded", timeout: 25_000 });
        } catch {
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

      if (site === "pixiv" && pixivConfirmed && fanboxDone) break;
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
    if (pixiv && !fanbox) fanbox = pixiv;
    if (!pixivProfile || (fanbox && !fanboxProfile)) {
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
      pixivProfile,
      fanboxProfile,
      frame: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    if (/Cannot find module 'puppeteer-core'/.test(message)) {
      job = { ...job, status: "error", error: "缺少 puppeteer-core。请在项目目录执行 pnpm i 后再试。", frame: null };
    } else {
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

export async function startBrowserLogin(site: LoginSite): Promise<LoginJobSnapshot> {
  if (loginJobBusy(job.status)) {
    if (job.site === site) return getLoginJob();
    throw new Error("已有登录窗口在进行，先完成或关掉那一个。");
  }
  stop = false;
  job = { ...idleJob(), status: "launching", site, relay: true };
  void runJob(site).catch((err) => {
    const message = err instanceof Error ? err.message : "登录失败";
    if (loginJobBusy(job.status) || job.status === "launching") {
      job = { ...job, status: "error", error: message };
    }
  });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && job.status === "launching") {
    await new Promise((r) => setTimeout(r, 150));
  }
  return getLoginJob();
}

export async function cancelBrowserLogin(): Promise<LoginJobSnapshot> {
  stop = true;
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
