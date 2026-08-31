import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeCandidates, pickSession } from "./browser-login";
import { getActiveProxy } from "./proxy.server";
import { parseProxyUrl } from "./proxy-url";
import { resolveIdentities } from "./site-identity.server";
import type { SiteProfile } from "./site-identity";

export type LoginSite = "pixiv" | "fanbox";

let busy = false;

function findChrome(): string {
  for (const path of chromeCandidates()) {
    if (path && existsSync(path)) return path;
  }
  throw new Error("找不到 Chrome 或 Edge。安装其中一个，或设置环境变量 KAMI_CHROME 指向浏览器。也可改回手动粘贴 Cookie。");
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

export async function captureBrowserLogin(site: LoginSite): Promise<{
  pixiv: string;
  fanbox: string;
  pixivProfile: SiteProfile | null;
  fanboxProfile: SiteProfile | null;
}> {
  if (busy) throw new Error("已有登录窗口在进行，先完成或关掉那一个。");
  busy = true;
  const profile = mkdtempSync(join(tmpdir(), "kami-login-"));
  let browser: { close: () => Promise<void> } | undefined;
  try {
    const { default: puppeteer } = await import("puppeteer-core");
    const executablePath = findChrome();
    const proxy = proxyArgs();
    const launched = await puppeteer.launch({
      headless: false,
      executablePath,
      userDataDir: profile,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1100,800",
        ...proxy.args,
      ],
    });
    browser = launched;
    const page = (await launched.pages())[0] ?? (await launched.newPage());
    if (proxy.user) {
      await page.authenticate({ username: proxy.user, password: proxy.password ?? "" });
    }
    const start =
      site === "fanbox"
        ? "https://www.fanbox.cc/login"
        : "https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F&source=pc&view_type=page";
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const cdp = await page.createCDPSession();

    const deadline = Date.now() + 4 * 60 * 1000;
    let pixiv = "";
    let fanbox = "";
    let triedFanbox = site === "fanbox";
    while (Date.now() < deadline) {
      const alive = typeof launched.connected === "boolean" ? launched.connected : true;
      if (!alive) throw new Error("登录窗口已关闭");
      const all = (await cdp.send("Network.getAllCookies")) as {
        cookies?: { name: string; value: string; domain?: string }[];
      };
      const picked = pickSession(all.cookies ?? []);
      pixiv = picked.pixiv || pixiv;
      fanbox = picked.fanbox || fanbox;
      if (site === "pixiv" && pixiv && !triedFanbox) {
        triedFanbox = true;
        try {
          await page.goto("https://www.fanbox.cc/", { waitUntil: "domcontentloaded", timeout: 20_000 });
        } catch {
          /* FANBOX is optional */
        }
        continue;
      }
      if (site === "pixiv" && pixiv) break;
      if (site === "fanbox" && fanbox) break;
      await new Promise((r) => setTimeout(r, 900));
    }
    if (site === "pixiv" && !pixiv) throw new Error("超时未检测到 Pixiv 登录。请在弹出的官方页面完成登录。");
    if (site === "fanbox" && !fanbox) throw new Error("超时未检测到 FANBOX 登录。请在弹出的官方页面完成登录。");
    const profiles = await resolveIdentities({ pixiv, fanbox });
    return { pixiv, fanbox, pixivProfile: profiles.pixiv, fanboxProfile: profiles.fanbox };
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    if (/Cannot find module 'puppeteer-core'/.test(message)) {
      throw new Error("缺少 puppeteer-core。请在项目目录执行 pnpm i 后再试。");
    }
    throw err instanceof Error ? err : new Error(message);
  } finally {
    busy = false;
    try {
      await browser?.close();
    } catch {
      /* already closed */
    }
    rmSync(profile, { recursive: true, force: true });
  }
}
