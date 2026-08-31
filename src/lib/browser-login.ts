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
  relay: boolean;
  pageUrl: string;
  viewWidth: number;
  viewHeight: number;
  frame: string | null;
  pixiv: string;
  fanbox: string;
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

/** Logged-in Pixiv PHPSESSID is `{memberId}_{token}`. Guest sessions are a bare token. */
export const PIXIV_SESSION_RE = /^(\d{2,12})_([A-Za-z0-9]{16,})$/;

export function loginJobBusy(status: LoginJobStatus): boolean {
  return status === "launching" || status === "waiting";
}

export function stripCookieName(raw: string, name: string): string {
  const v = raw.trim();
  if (!v) return "";
  const prefix = `${name}=`;
  return v.toLowerCase().startsWith(prefix.toLowerCase()) ? v.slice(prefix.length).trim() : v;
}

export function pixivSessionValue(raw: string): string {
  return stripCookieName(raw, "PHPSESSID");
}

export function fanboxSessionValue(raw: string): string {
  return stripCookieName(raw, "FANBOXSESSID");
}

export function isPixivLoggedInSession(raw: string): boolean {
  return PIXIV_SESSION_RE.test(pixivSessionValue(raw));
}

export function pixivUserIdFromCookie(raw?: string): string | undefined {
  const match = PIXIV_SESSION_RE.exec(pixivSessionValue(raw ?? ""));
  return match?.[1];
}

export function sanitizePixivCookie(raw?: string): string {
  const value = pixivSessionValue(raw ?? "");
  return isPixivLoggedInSession(value) ? value : "";
}

export function pixivCookieHeader(raw?: string): string | undefined {
  const value = sanitizePixivCookie(raw);
  if (!value) return undefined;
  return `PHPSESSID=${value}`;
}

export function fanboxCookieHeader(raw?: string): string | undefined {
  const value = fanboxSessionValue(raw ?? "");
  if (value.length < 16) return undefined;
  return `FANBOXSESSID=${value}`;
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
      if (!domain || domain.includes("pixiv")) pixiv = pixivSessionValue(value);
    }
    if (name === "fanboxsessid" && value.length >= 16) {
      if (!domain || domain.includes("fanbox")) fanbox = value;
    }
  }
  return { pixiv, fanbox };
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
  if (headerFanbox && headerFanbox.length >= 16) fanbox = headerFanbox;

  if (!pixiv && isPixivLoggedInSession(text)) pixiv = pixivSessionValue(text);

  return { pixiv, fanbox };
}

export function canShowLoginWindow(platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GROK_AGENT || env.GROK_SESSION_ID || env.VERCEL || env.K_SERVICE) return false;
  if (platform === "win32" || platform === "darwin") return true;
  return Boolean(
    (env.DISPLAY?.trim() || env.WAYLAND_DISPLAY?.trim()) &&
      (env.XDG_CURRENT_DESKTOP?.trim() || env.DESKTOP_SESSION?.trim() || env.WAYLAND_DISPLAY?.trim()),
  );
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
    "/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
  ];
}
