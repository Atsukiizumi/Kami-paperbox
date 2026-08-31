export type CookieLike = {
  name: string;
  value: string;
  domain?: string;
};

export type BrowserSession = {
  pixiv: string;
  fanbox: string;
};

export type LoginSite = "pixiv" | "fanbox";

export type LoginJobStatus = "idle" | "launching" | "waiting" | "done" | "error";

export type LoginJobSnapshot = {
  status: LoginJobStatus;
  site: LoginSite | null;
  error: string | null;
  chrome: string | null;
  pixiv: string;
  fanbox: string;
  pixivProfile: { id: string; name: string; avatar?: string } | null;
  fanboxProfile: { id: string; name: string; avatar?: string } | null;
};

export function loginJobBusy(status: LoginJobStatus): boolean {
  return status === "launching" || status === "waiting";
}

export function pickSession(cookies: CookieLike[]): BrowserSession {
  let pixiv = "";
  let fanbox = "";
  for (const cookie of cookies) {
    const name = cookie.name.toLowerCase();
    const value = cookie.value.trim();
    if (!value) continue;
    const domain = (cookie.domain ?? "").toLowerCase();
    if (name === "phpsessid" && value.length >= 16) {
      if (!domain || domain.includes("pixiv")) pixiv = value;
    }
    if (name === "fanboxsessid" && value.length >= 8) fanbox = value;
  }
  return { pixiv, fanbox };
}

export function chromeCandidates(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
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
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ];
}
