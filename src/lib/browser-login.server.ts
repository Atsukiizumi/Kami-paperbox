import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canShowLoginWindow,
  chromeCandidates,
  loginJobBusy,
  pickSession,
  type LoginJobSnapshot,
  type LoginSite,
} from "./browser-login";
import { getActiveProxy } from "./proxy.server";
import { parseProxyUrl } from "./proxy-url";
import { parseFanboxMe, parsePixivMe, type SiteProfile } from "./site-identity";
import { resolveIdentities } from "./site-identity.server";

type PageLike = {
  authenticate: (c: { username: string; password: string }) => Promise<void>;
  goto: (url: string, opts?: { waitUntil?: "domcontentloaded"; timeout?: number }) => Promise<unknown>;
  createCDPSession: () => Promise<{ send: (method: string) => Promise<unknown> }>;
  bringToFront: () => Promise<void>;
  url: () => string;
  content: () => Promise<string>;
  evaluate: (pageFunction: () => unknown) => Promise<unknown>;
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
  pixiv: "",
  fanbox: "",
  pixivProfile: null,
  fanboxProfile: null,
});

let job: LoginJobSnapshot = idleJob();
let stop = false;
let closer: (() => Promise<void>) | null = null;

export function getLoginJob(): LoginJobSnapshot {
  return { ...job };
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

async function launchChrome(profile: string): Promise<{ browser: BrowserLike; chrome: string; proxy: ReturnType<typeof proxyArgs> }> {
  const { default: puppeteer } = await import("puppeteer-core");
  const proxy = proxyArgs();
  const common = {
    headless: false as const,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: 60_000,
    pipe: process.platform === "win32",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--window-size=1100,800",
      "--window-position=120,80",
      ...proxy.args,
    ],
  };

  const tried: string[] = [];
  for (const executablePath of chromeCandidates()) {
    if (!executablePath || !existsSync(executablePath)) continue;
    tried.push(executablePath);
    try {
      const browser = (await puppeteer.launch({ ...common, executablePath })) as unknown as BrowserLike;
      return { browser, chrome: executablePath, proxy };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[kami] 无法启动 ${executablePath}: ${message}`);
      if (common.pipe) {
        try {
          const browser = (await puppeteer.launch({ ...common, pipe: false, executablePath })) as unknown as BrowserLike;
          return { browser, chrome: executablePath, proxy };
        } catch (retryErr) {
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.warn(`[kami] 无法启动 ${executablePath} (no pipe): ${retryMessage}`);
        }
      }
    }
  }

  for (const channel of ["chrome", "chrome-beta", "chrome-dev"] as const) {
    tried.push(`channel:${channel}`);
    try {
      const browser = (await puppeteer.launch({ ...common, channel })) as unknown as BrowserLike;
      return { browser, chrome: channel, proxy };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[kami] 无法启动 channel:${channel}: ${message}`);
    }
  }

  if (/Cannot find module 'puppeteer-core'/.test(tried.join(" "))) {
    throw new Error("缺少 puppeteer-core。请在项目目录执行 pnpm i 后再试。");
  }
  throw new Error(
    `找不到可用的 Chrome / Edge。${tried.length ? `已尝试：${tried.join("、")}。` : ""}安装其中一个，或设置环境变量 KAMI_CHROME 指向 chrome.exe / msedge.exe。也可以改用手贴 Cookie。`,
  );
}

function isPixivLoginUrl(url: string): boolean {
  return /accounts\.pixiv\.net/i.test(url) || /pixiv\.net\/login/i.test(url);
}

async function readCookies(page: PageLike): Promise<ReturnType<typeof pickSession>> {
  const cdp = await page.createCDPSession();
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

async function runJob(site: LoginSite): Promise<void> {
  if (!canShowLoginWindow()) {
    throw new Error("当前环境没有桌面，弹不出 Chrome / Edge。请在本机运行纸匣，或改用手贴 Cookie。");
  }
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
    job = { ...job, status: "waiting", chrome: launched.chrome, error: null };
    console.info(`[kami] 已打开登录窗口: ${launched.chrome}`);

    const page = (await browser.pages())[0] ?? (await browser.newPage());
    if (launched.proxy.user) {
      await page.authenticate({ username: launched.proxy.user, password: launched.proxy.password ?? "" });
    }
    const start =
      site === "fanbox"
        ? "https://www.fanbox.cc/login"
        : "https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F&source=pc&view_type=page";
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 45_000 });
    try {
      await page.bringToFront();
    } catch {
      /* window might still be in the taskbar */
    }

    const deadline = Date.now() + 4 * 60 * 1000;
    let pixiv = "";
    let fanbox = "";
    let pixivProfile: SiteProfile | null = null;
    let fanboxProfile: SiteProfile | null = null;
    let triedFanbox = site === "fanbox";
    let pixivConfirmed = false;
    let openedPixivHome = false;
    let pixivSeenAt = 0;
    while (Date.now() < deadline && !stop) {
      const alive = typeof browser.connected === "boolean" ? browser.connected : true;
      if (!alive) throw new Error("登录窗口已关闭");
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

      if (site === "pixiv" && pixivConfirmed && !triedFanbox) {
        triedFanbox = true;
        try {
          await page.goto("https://www.fanbox.cc/", { waitUntil: "domcontentloaded", timeout: 20_000 });
          const after = await readCookies(page);
          fanbox = after.fanbox || fanbox;
          fanboxProfile = (await profileFromFanboxPage(page)) ?? fanboxProfile;
        } catch {
          /* FANBOX is optional */
        }
      }

      if (site === "fanbox" && fanbox && !fanboxProfile) {
        fanboxProfile = await profileFromFanboxPage(page);
      }

      if (site === "pixiv" && pixivConfirmed) break;
      if (site === "fanbox" && fanbox) break;
      await new Promise((r) => setTimeout(r, 900));
    }
    if (stop) throw new Error("已取消登录窗口");
    if (site === "pixiv" && !pixiv) {
      throw new Error("超时未检测到 Pixiv 登录。请在弹出的官方页面完成登录（访客 Cookie 不算）。");
    }
    if (site === "fanbox" && !fanbox) {
      throw new Error("超时未检测到 FANBOX 登录。请在弹出的官方页面完成登录。");
    }
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
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    if (/Cannot find module 'puppeteer-core'/.test(message)) {
      job = { ...job, status: "error", error: "缺少 puppeteer-core。请在项目目录执行 pnpm i 后再试。" };
    } else {
      job = { ...job, status: "error", error: message };
    }
  } finally {
    closer = null;
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
  job = { ...idleJob(), status: "launching", site };
  void runJob(site);
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
    job = { ...job, status: "error", error: "已取消登录窗口" };
  }
  return getLoginJob();
}
