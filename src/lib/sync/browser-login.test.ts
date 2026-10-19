import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FANBOX_LOGIN_URL,
  X_LOGIN_URL,
  X_RELAY_403_HINT,
  canShowLoginWindow,
  chromeCandidates,
  fanboxCookieHeader,
  fanboxSessionFrom,
  isHeadlessShellPath,
  isPixivLoggedInSession,
  isXRelayBlockedResponse,
  launchAttemptsForSite,
  loginJobBusy,
  normalizeHeadlessUa,
  orderLaunchCandidates,
  parseCookieDump,
  parseLoginSite,
  pickSession,
  pickXSession,
  pixivCookieHeader,
  pixivUserIdFromCookie,
  sanitizePixivCookie,
} from "./browser-login.ts";

test("picks logged-in pixiv and fanbox session cookies", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "12345678_abcdef0123456789deadbeef", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "12345678_abcdef0123456789deadbeef", domain: ".fanbox.cc" },
    { name: "other", value: "nope", domain: ".pixiv.net" },
  ]);
  assert.equal(got.pixiv, "12345678_abcdef0123456789deadbeef");
  assert.equal(got.fanbox, "12345678_abcdef0123456789deadbeef");
});

test("ignores guest PHPSESSID and guest FANBOXSESSID", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "abcdef0123456789deadbeef", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "fanbox-guest-token-16ok", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.pixiv, "");
  assert.equal(got.fanbox, "");
});

test("reads PHPSESSID on fanbox domain as fanbox session", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "42_abcdef0123456789deadbeef", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.fanbox, "42_abcdef0123456789deadbeef");
});

test("ignores short or empty values", () => {
  const got = pickSession([
    { name: "PHPSESSID", value: "short", domain: ".pixiv.net" },
    { name: "FANBOXSESSID", value: "", domain: ".fanbox.cc" },
  ]);
  assert.equal(got.pixiv, "");
  assert.equal(got.fanbox, "");
});

test("logged-in session helper and header", () => {
  assert.equal(isPixivLoggedInSession("12345678_abcdef0123456789deadbeef"), true);
  assert.equal(isPixivLoggedInSession("PHPSESSID=42_abcdef0123456789deadbeef"), true);
  assert.equal(isPixivLoggedInSession("PHPSESSID=42_abcdef0123456789deadbeef; p_ab_id=2"), true);
  assert.equal(isPixivLoggedInSession("1_abcdefghijklmnop"), true);
  assert.equal(isPixivLoggedInSession("abcdef0123456789deadbeef"), false);
  assert.equal(pixivUserIdFromCookie("PHPSESSID=42_abcdef0123456789deadbeef"), "42");
  assert.equal(sanitizePixivCookie("abcdef0123456789deadbeef"), "");
  assert.equal(pixivCookieHeader("abcdef0123456789deadbeef"), undefined);
  assert.equal(
    pixivCookieHeader("PHPSESSID=42_abcdef0123456789deadbeef"),
    "PHPSESSID=42_abcdef0123456789deadbeef",
  );
});

test("fanbox header uses logged-in token and can fall back to pixiv", () => {
  assert.equal(fanboxCookieHeader("fanbox-guest-token-16ok"), undefined);
  assert.equal(
    fanboxCookieHeader("42_abcdef0123456789deadbeef"),
    "FANBOXSESSID=42_abcdef0123456789deadbeef; PHPSESSID=42_abcdef0123456789deadbeef",
  );
  assert.equal(
    fanboxCookieHeader("", "99_abcdef0123456789deadbeef"),
    "FANBOXSESSID=99_abcdef0123456789deadbeef; PHPSESSID=99_abcdef0123456789deadbeef",
  );
  assert.equal(fanboxSessionFrom("", "99_abcdef0123456789deadbeef"), "99_abcdef0123456789deadbeef");
  assert.equal(
    fanboxCookieHeader("42_fanboxsessionvaluexx", "99_pixivsessionvaluexxx"),
    "FANBOXSESSID=42_fanboxsessionvaluexx; PHPSESSID=99_pixivsessionvaluexxx",
  );
});

test("fanbox login goes through pixiv account picker and auth/start", () => {
  assert.equal(
    FANBOX_LOGIN_URL,
    "https://accounts.pixiv.net/login?prompt=select_account&return_to=https%3A%2F%2Fwww.fanbox.cc%2Fauth%2Fstart&source=fanbox",
  );
});

test("x login url is the official flow entry", () => {
  assert.equal(X_LOGIN_URL, "https://x.com/i/flow/login");
});

test("login site whitelist lets pixiv/fanbox/x through and rejects the rest", () => {
  assert.equal(parseLoginSite("pixiv"), "pixiv");
  assert.equal(parseLoginSite("fanbox"), "fanbox");
  assert.equal(parseLoginSite("x"), "x");
  assert.equal(parseLoginSite("twitter"), null);
  assert.equal(parseLoginSite(""), null);
  assert.equal(parseLoginSite(undefined), null);
  assert.equal(parseLoginSite(1), null);
  assert.equal(parseLoginSite({ site: "x" }), null);
});

test("pickXSession：已登录（.x.com 成对）返回规范串", () => {
  const token = "a1b2c3d4e5f6a7b8c9d0";
  const ct0 = "cT0vAlUe-4Me_xYz9";
  assert.equal(
    pickXSession([
      { name: "auth_token", value: token, domain: ".x.com" },
      { name: "ct0", value: ct0, domain: ".x.com" },
      { name: "guest_id", value: "guest-noise", domain: ".x.com" },
    ]),
    `auth_token=${token}; ct0=${ct0}`,
  );
});

test("pickXSession：未登录（无 auth_token）返回 null", () => {
  assert.equal(
    pickXSession([
      { name: "guest_id", value: "guest-noise", domain: ".x.com" },
      { name: "ct0", value: "cT0vAlUe-4Me_xYz9", domain: ".x.com" },
    ]),
    null,
  );
  assert.equal(pickXSession([]), null);
});

test("pickXSession：只有 auth_token 没有 ct0 返回 null（sanitize 双值门槛）", () => {
  assert.equal(
    pickXSession([{ name: "auth_token", value: "a1b2c3d4e5f6a7b8c9d0", domain: ".x.com" }]),
    null,
  );
});

test("pickXSession：多域同名取 .x.com 域优先；空值不算数", () => {
  assert.equal(
    pickXSession([
      { name: "auth_token", value: "FROM-TWITTER-DOMAIN", domain: ".twitter.com" },
      { name: "auth_token", value: "FROM-X-DOMAIN", domain: ".x.com" },
      { name: "ct0", value: "CT0-ON-X", domain: "x.com" },
      { name: "ct0", value: "", domain: ".x.com" },
    ]),
    "auth_token=FROM-X-DOMAIN; ct0=CT0-ON-X",
  );
  // auth_token 只在非 x 域、ct0 在 .x.com：仍成对可用（fallback 取 twitter 域值）
  assert.equal(
    pickXSession([
      { name: "auth_token", value: "TW-ONLY", domain: ".twitter.com" },
      { name: "ct0", value: "CT0-ON-X", domain: ".x.com" },
    ]),
    "auth_token=TW-ONLY; ct0=CT0-ON-X",
  );
});

test("parses cookie dumps from headers, json, and netscape files", () => {
  const header = parseCookieDump("PHPSESSID=12345678_abcdef0123456789deadbeef; path=/");
  assert.equal(header.pixiv, "12345678_abcdef0123456789deadbeef");

  const json = parseCookieDump(
    JSON.stringify([
      { name: "PHPSESSID", value: "42_abcdef0123456789deadbeef", domain: ".pixiv.net" },
      { name: "FANBOXSESSID", value: "42_abcdef0123456789deadbeef", domain: ".fanbox.cc" },
    ]),
  );
  assert.equal(json.pixiv, "42_abcdef0123456789deadbeef");
  assert.equal(json.fanbox, "42_abcdef0123456789deadbeef");

  const netscape = parseCookieDump(
    [
      "# Netscape HTTP Cookie File",
      ".pixiv.net\tTRUE\t/\tTRUE\t0\tPHPSESSID\t99_abcdef0123456789deadbeef",
    ].join("\n"),
  );
  assert.equal(netscape.pixiv, "99_abcdef0123456789deadbeef");

  const guest = parseCookieDump("PHPSESSID=abcdef0123456789deadbeef");
  assert.equal(guest.pixiv, "");
  assert.equal(parseCookieDump("FANBOXSESSID=fanbox-guest-token-16ok").fanbox, "");

  // 拆框（2026-09-14）：裸会话值只认 Pixiv，不再同时填 fanbox——两站格式同形，
  // 双填会让「粘一个框、另一个框跟着变」。FANBOX 裸值走定向粘贴按站点解释。
  const bare = parseCookieDump("77_abcdef0123456789deadbeef");
  assert.equal(bare.pixiv, "77_abcdef0123456789deadbeef");
  assert.equal(bare.fanbox, "");
});

test("windows chrome candidates include edge", () => {
  const list = chromeCandidates("win32", {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
    KAMI_CHROME: "D:\\Chrome\\chrome.exe",
  });
  assert.equal(list[0], "D:\\Chrome\\chrome.exe");
  assert.ok(list.some((p) => p.endsWith("msedge.exe")));
  assert.ok(list.some((p) => p.includes("Chrome SxS")));
});

// ── R1 候选链（AC1）：KAMI_CHROME → Chrome → Edge → headless-shell ────────────
// 存在性经 orderLaunchCandidates 的 exists 参数注入伪造；pw 两个构建模拟
// playwrightChromeBins 的扫描产物（真 Chrome for Testing + headless-shell）。

const PW_CHROME = "/pw/chromium-1234/chrome-linux64/chrome";
const PW_SHELL =
  "/pw/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const PF_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PF86_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function mergedWinCandidates(env: Record<string, string | undefined> = {}): string[] {
  return [
    ...chromeCandidates("win32", {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      ...env,
    }),
    PW_CHROME,
    PW_SHELL,
  ];
}

test("R1 全有布局：KAMI_CHROME 最优先，真浏览器（Chrome→Edge→pw Chrome）全排在 headless-shell 前", () => {
  const chain = orderLaunchCandidates(
    mergedWinCandidates({ KAMI_CHROME: "D:\\My\\chrome.exe" }),
    () => true,
  );
  assert.equal(chain[0], "D:\\My\\chrome.exe", "用户指定的 KAMI_CHROME 恒最优先");
  const firstShell = chain.findIndex(isHeadlessShellPath);
  assert.ok(firstShell > 0);
  assert.equal(chain[firstShell], PW_SHELL, "唯一的 headless-shell 垫底");
  assert.equal(chain.length, firstShell + 1, "shell 之后不得再有真浏览器被压后");
  assert.equal(chain[1], PF_CHROME, "KAMI_CHROME 之后先 Chrome");
  const edgeIdx = chain.indexOf(PF86_EDGE);
  assert.ok(edgeIdx > 1, "Edge 在 Chrome 之后");
  assert.ok(
    chain.indexOf(PW_CHROME) > edgeIdx,
    "playwright 真 Chrome 在系统 Edge 之后、仍在 shell 之前",
  );
});

test("R1 仅 Edge 存在（无 Chrome 机器）：探测链只剩 Edge", () => {
  assert.deepEqual(
    orderLaunchCandidates(mergedWinCandidates(), (p) => p === PF86_EDGE),
    [PF86_EDGE],
  );
});

test("R1 仅 Chrome 存在：探测链只剩 Chrome", () => {
  assert.deepEqual(
    orderLaunchCandidates(mergedWinCandidates(), (p) => p === PF_CHROME),
    [PF_CHROME],
  );
});

test("R1 仅 headless-shell 存在（Docker）：探测链只剩 shell", () => {
  assert.deepEqual(
    orderLaunchCandidates(mergedWinCandidates(), (p) => p === PW_SHELL),
    [PW_SHELL],
  );
});

test("R1 playwright 目录里 shell 抢在完整 Chrome 前时，合并排序仍真浏览器优先", () => {
  const chain = orderLaunchCandidates([PW_SHELL, PW_CHROME, "/usr/bin/google-chrome"], () => true);
  assert.deepEqual(
    chain,
    [PW_CHROME, "/usr/bin/google-chrome", PW_SHELL],
    "层内保持传入顺序，shell 恒垫底",
  );
});

test("R1 linux 候选补齐 Edge 双形态，且 chromeCandidates 只出真浏览器", () => {
  const list = chromeCandidates("linux", {});
  assert.ok(list.includes("/usr/bin/microsoft-edge"));
  assert.ok(list.includes("/usr/bin/microsoft-edge-stable"));
  assert.ok(
    !list.some((p) => isHeadlessShellPath(p)),
    "headless-shell 由 playwright 扫描层供给，不进真浏览器表",
  );
});

// ── R2 启动策略（AC2）：X 有头优先 + 降级链；pixiv/fanbox 恒无头 ─────────────

test("R2 X：真浏览器有头优先，降级 无头真浏览器（UA 规范化）→ headless-shell", () => {
  const attempts = launchAttemptsForSite("x", [PF_CHROME, PF86_EDGE, PW_SHELL]);
  assert.deepEqual(
    attempts.map((a) => [a.executablePath, a.headless, a.normalizeUa]),
    [
      [PF_CHROME, false, false],
      [PF86_EDGE, false, false],
      [PF_CHROME, true, true],
      [PF86_EDGE, true, true],
      [PW_SHELL, "shell", true],
    ],
    "两级降级：headful 真浏览器 → headless 真浏览器（UA 去 Headless）→ shell（UA 去 Headless）",
  );
});

test("R2 X 仅 headless-shell 可用：直接 shell 模式 + UA 规范化（无真浏览器不空跑有头档）", () => {
  assert.deepEqual(launchAttemptsForSite("x", [PW_SHELL]), [
    { executablePath: PW_SHELL, headless: "shell", normalizeUa: true },
  ]);
});

test("R2 pixiv / fanbox 恒无头且不动 UA（现状回归锁，R4）", () => {
  for (const site of ["pixiv", "fanbox"] as const) {
    assert.deepEqual(launchAttemptsForSite(site, [PF_CHROME, PW_SHELL]), [
      { executablePath: PF_CHROME, headless: true, normalizeUa: false },
      { executablePath: PW_SHELL, headless: "shell", normalizeUa: false },
    ]);
  }
});

test("R2 normalizeHeadlessUa：HeadlessChrome → Chrome，无 Headless 字样则原样", () => {
  const headless =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36";
  const headed =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  assert.equal(normalizeHeadlessUa(headless), headed);
  assert.ok(!normalizeHeadlessUa(headless).includes("Headless"));
  assert.equal(normalizeHeadlessUa(headed), headed);
});

// ── R3 403 侦测（AC3）：X 域 Document 403 才触发，404/500/子资源不误报 ────────
// wiring：runJob 在 screencast CDP 会话上挂 Network.responseReceived → 命中即
// throw X_RELAY_403_HINT → catch 置 job.error 且保留 token 单次补读（P1 修复）→
// 发起方下一次轮询经 readLoginJobForRelay 读到文案 → session-relay 按 job.error
// 展示。「读到即清 / 错 token 仍 401 三键体」的路由级锁在 login-browser.test.tsx。

test("R3 X 域 Document 403 触发；404 / 500 / 子资源 / 他站 / 无 URL 不触发", () => {
  assert.equal(
    isXRelayBlockedResponse({ status: 403, type: "Document", url: "https://x.com/i/flow/login" }),
    true,
  );
  assert.equal(
    isXRelayBlockedResponse({
      status: 403,
      type: "Document",
      url: "https://mobile.twitter.com/login",
    }),
    true,
  );
  assert.equal(
    isXRelayBlockedResponse({ status: 404, type: "Document", url: "https://x.com/i/flow/login" }),
    false,
  );
  assert.equal(
    isXRelayBlockedResponse({ status: 500, type: "Document", url: "https://x.com/" }),
    false,
  );
  assert.equal(
    isXRelayBlockedResponse({ status: 403, type: "XHR", url: "https://api.x.com/1.1/j/cockpit" }),
    false,
  );
  assert.equal(
    isXRelayBlockedResponse({ status: 403, type: "Script", url: "https://abs.twimg.com/a.js" }),
    false,
  );
  assert.equal(
    isXRelayBlockedResponse({
      status: 403,
      type: "Document",
      url: "https://accounts.pixiv.net/login",
    }),
    false,
  );
  assert.equal(isXRelayBlockedResponse({ status: 403, type: "Document", url: "" }), false);
});

test("R3 403 文案给手贴 Cookie 引导（auth_token 与 ct0），口径不提账号密码", () => {
  assert.ok(X_RELAY_403_HINT.includes("403"));
  assert.ok(X_RELAY_403_HINT.includes("auth_token"));
  assert.ok(X_RELAY_403_HINT.includes("ct0"));
  assert.ok(!X_RELAY_403_HINT.toLowerCase().includes("密码"));
});

test("login window needs a real desktop, not a grok/server display", () => {
  assert.equal(canShowLoginWindow("linux", {}), false);
  assert.equal(canShowLoginWindow("linux", { DISPLAY: ":0" }), false);
  assert.equal(canShowLoginWindow("linux", { DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" }), true);
  assert.equal(canShowLoginWindow("linux", { GROK_AGENT: "1", DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" }), false);
  assert.equal(canShowLoginWindow("win32", {}), true);
  assert.equal(canShowLoginWindow("win32", { GROK_AGENT: "1" }), false);
});

test("login job busy flags", () => {
  assert.equal(loginJobBusy("idle"), false);
  assert.equal(loginJobBusy("done"), false);
  assert.equal(loginJobBusy("error"), false);
  assert.equal(loginJobBusy("launching"), true);
  assert.equal(loginJobBusy("waiting"), true);
});
