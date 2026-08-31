#!/usr/bin/env node
/**
 * Headless XHR sniffer for upstream reverse-engineering.
 *
 *   node scripts/sniff-xhr.mjs "https://www.pixiv.net/ranking.php?mode=daily"
 *   SNIFF_COOKIE='PHPSESSID=…' node scripts/sniff-xhr.mjs "https://www.pixiv.net/"
 *
 * Optional env: KAMI_CHROME, SNIFF_WAIT_MS (default 4000), SNIFF_COOKIE, SNIFF_SCRIPTS=1
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const target = process.argv[2];
if (!target || !/^https:\/\//i.test(target)) {
  console.error("usage: node scripts/sniff-xhr.mjs <https-url>");
  process.exit(1);
}

const waitMs = Number(process.env.SNIFF_WAIT_MS || 4000);
const cookieHeader = (process.env.SNIFF_COOKIE || "").trim();

const ADS =
  /google-analytics|googletagmanager|doubleclick|ads-pixiv|prebid|microad|adingo|genieesspv|ladsp|impact-ad|jsdelivr\.net\/gh\/prebid|google\.com\/(ccm|pagead|rmkt)|googlesyndication|socdm\.com|i-mobile|im-apps\.net|pixon\.ads-pixiv|cdn-cgi\/challenge|criteo\.|geniee\.|adrecover/i;

const FIRST_PARTY = /(^|\.)(pixiv\.net|pximg\.net|fanbox\.cc|yande\.re|konachan\.com|konachan\.net|donmai\.us)$/;

function chromeBins() {
  const extra = [process.env.KAMI_CHROME, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH].filter(
    (v) => v && existsSync(v),
  );
  const home = homedir();
  const guesses = [
    "/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(home, "AppData/Local/Google/Chrome/Application/chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return [...extra, ...guesses].filter((p) => p && existsSync(p));
}

const SKIP_TYPE = new Set(["stylesheet", "font", "ping", "manifest"]);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function keep(url, type) {
  const host = hostOf(url);
  if (ADS.test(url) || ADS.test(host)) return false;
  if (SKIP_TYPE.has(type)) return false;
  if (type === "document") return FIRST_PARTY.test(host);
  if (type === "script") return process.env.SNIFF_SCRIPTS === "1" && FIRST_PARTY.test(host);
  if (type === "xhr" || type === "fetch") return FIRST_PARTY.test(host);
  return FIRST_PARTY.test(host) && /\/ajax\/|api\.fanbox|format=json|ranking\.php|\/post\.json|\/posts\.json/i.test(url);
}

const { default: puppeteer } = await import("puppeteer-core");
const bins = chromeBins();
if (!bins.length) {
  console.error("No Chrome found. Set KAMI_CHROME to chrome / chrome-headless-shell.");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: bins[0],
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-setuid-sandbox"],
  defaultViewport: { width: 980, height: 720 },
});

const page = (await browser.pages())[0] ?? (await browser.newPage());
await page.setUserAgent(
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
);

if (cookieHeader) {
  const pair = cookieHeader.includes("=") ? cookieHeader : `PHPSESSID=${cookieHeader}`;
  const [name, ...rest] = pair.split("=");
  const value = rest.join("=");
  const host = new URL(target).hostname;
  await page.setCookie({ name: name.trim(), value, domain: host.replace(/^www\./, ".") });
}

const rows = [];
page.on("request", (req) => {
  const url = req.url();
  const type = req.resourceType();
  if (!keep(url, type)) return;
  rows.push({
    method: req.method(),
    type,
    url,
    status: 0,
  });
});
page.on("response", (res) => {
  const url = res.url();
  const row = rows.find((r) => r.url === url && !r.status);
  if (row) row.status = res.status();
});

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await new Promise((r) => setTimeout(r, Number.isFinite(waitMs) ? waitMs : 4000));
} catch (err) {
  console.error("goto failed:", err instanceof Error ? err.message : err);
}

const seen = new Set();
for (const row of rows) {
  const key = `${row.method} ${row.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const short = row.url.length > 180 ? `${row.url.slice(0, 177)}...` : row.url;
  console.log(`${String(row.status || "?").padStart(3)} ${row.method.padEnd(4)} ${row.type.padEnd(8)} ${short}`);
}
console.log(`# ${seen.size} requests  chrome=${bins[0]}`);

await browser.close();
