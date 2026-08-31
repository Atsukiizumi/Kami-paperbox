export const THEME_IDS = ["washi", "aosumi", "shusha", "songyan", "koke"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export type ResolvedAppearance = "light" | "dark";

export const DEFAULT_THEME: ThemeId = "washi";
export const DEFAULT_APPEARANCE: Appearance = "dark";

/** Must match `useSettings` persist `name`. */
export const SETTINGS_STORAGE_KEY = "kami-settings";

export type ThemeTokens = {
  bg: string;
  surface: string;
  elevated: string;
  fg: string;
  muted: string;
  subtle: string;
  accent: string;
  accentFg: string;
  danger: string;
  ok: string;
};

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  description: string;
  light: ThemeTokens;
  dark: ThemeTokens;
};

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  washi: {
    id: "washi",
    name: "和纸",
    description: "暖墨与宣纸",
    dark: {
      bg: "#0e0d0c",
      surface: "#171614",
      elevated: "#211f1c",
      fg: "#f3efe8",
      muted: "#9c958c",
      subtle: "#6f6a64",
      accent: "#e8dfd2",
      accentFg: "#1a1714",
      danger: "#e8a09a",
      ok: "#9cba9a",
    },
    light: {
      bg: "#f3ece0",
      surface: "#e8e0d2",
      elevated: "#faf6ee",
      fg: "#12110f",
      muted: "#5c574f",
      subtle: "#8a8378",
      accent: "#1c1a17",
      accentFg: "#f3ece0",
      danger: "#b4544a",
      ok: "#3d6b42",
    },
  },
  aosumi: {
    id: "aosumi",
    name: "青墨",
    description: "冷调蓝黑",
    dark: {
      bg: "#0d1116",
      surface: "#161c24",
      elevated: "#1e2630",
      fg: "#e6edf4",
      muted: "#8a96a3",
      subtle: "#65707c",
      accent: "#8aa4b8",
      accentFg: "#0d1116",
      danger: "#d49a94",
      ok: "#8fb09a",
    },
    light: {
      bg: "#eef2f6",
      surface: "#e2e8ee",
      elevated: "#f7f9fb",
      fg: "#12161c",
      muted: "#55606c",
      subtle: "#7a8692",
      accent: "#3a5368",
      accentFg: "#eef2f6",
      danger: "#b4544a",
      ok: "#3d6b42",
    },
  },
  shusha: {
    id: "shusha",
    name: "朱砂",
    description: "印泥朱",
    dark: {
      bg: "#140f0e",
      surface: "#1d1715",
      elevated: "#2a201c",
      fg: "#f3ebe4",
      muted: "#9a8b82",
      subtle: "#71665e",
      accent: "#c45c48",
      accentFg: "#f3ebe4",
      danger: "#e8a09a",
      ok: "#9cba9a",
    },
    light: {
      bg: "#f6eee6",
      surface: "#ece2d6",
      elevated: "#fbf7f2",
      fg: "#1c1412",
      muted: "#6a5c54",
      subtle: "#9a8b82",
      accent: "#a83c2c",
      accentFg: "#fbf7f2",
      danger: "#b4544a",
      ok: "#3d6b42",
    },
  },
  songyan: {
    id: "songyan",
    name: "松烟",
    description: "松烟墨",
    dark: {
      bg: "#0b0b0b",
      surface: "#161616",
      elevated: "#222222",
      fg: "#f1f0ec",
      muted: "#979790",
      subtle: "#6d6d68",
      accent: "#d8d4cc",
      accentFg: "#121210",
      danger: "#d0908c",
      ok: "#8aaa88",
    },
    light: {
      bg: "#f3f2ee",
      surface: "#e7e6e1",
      elevated: "#fcfcfa",
      fg: "#141413",
      muted: "#5e5e59",
      subtle: "#8a8a84",
      accent: "#1a1a18",
      accentFg: "#f3f2ee",
      danger: "#b4544a",
      ok: "#3d6b42",
    },
  },
  koke: {
    id: "koke",
    name: "苔色",
    description: "茶苔绿",
    dark: {
      bg: "#10140e",
      surface: "#191e16",
      elevated: "#242a1e",
      fg: "#ecefe4",
      muted: "#92988a",
      subtle: "#6a7064",
      accent: "#8b9a70",
      accentFg: "#10140e",
      danger: "#d49a94",
      ok: "#8b9a70",
    },
    light: {
      bg: "#f0f2e8",
      surface: "#e4e7d8",
      elevated: "#f7f8f0",
      fg: "#181c14",
      muted: "#5c6354",
      subtle: "#8a9080",
      accent: "#4a5836",
      accentFg: "#f0f2e8",
      danger: "#b4544a",
      ok: "#3d6b42",
    },
  },
};

export const THEME_LIST: ThemeDefinition[] = THEME_IDS.map((id) => THEMES[id]);

const HEX = /^#([0-9a-fA-F]{6})$/;

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}

export function isAppearance(value: string): value is Appearance {
  return (APPEARANCES as readonly string[]).includes(value);
}

export function parseThemeId(value: unknown): ThemeId {
  return typeof value === "string" && isThemeId(value) ? value : DEFAULT_THEME;
}

export function parseAppearance(value: unknown): Appearance {
  return typeof value === "string" && isAppearance(value) ? value : DEFAULT_APPEARANCE;
}

export function resolveAppearance(
  appearance: Appearance,
  systemDark: boolean,
): ResolvedAppearance {
  if (appearance === "light") return "light";
  if (appearance === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function themeTokens(themeId: ThemeId, resolved: ResolvedAppearance): ThemeTokens {
  return THEMES[themeId][resolved];
}

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

export type StoredTheme = {
  theme: ThemeId;
  appearance: Appearance;
};

export function readStoredTheme(raw: string | null): StoredTheme {
  if (!raw) return { theme: DEFAULT_THEME, appearance: DEFAULT_APPEARANCE };
  try {
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> } & Record<string, unknown>;
    const state = parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
    return {
      theme: parseThemeId(state.theme),
      appearance: parseAppearance(state.appearance),
    };
  } catch {
    return { theme: DEFAULT_THEME, appearance: DEFAULT_APPEARANCE };
  }
}

export function applyDocumentTheme(
  themeId: string,
  appearance: Appearance,
  options?: {
    root?: HTMLElement;
    systemDark?: boolean;
    themeColorMeta?: { setAttribute: (name: string, value: string) => void } | null;
  },
): { theme: ThemeId; resolved: ResolvedAppearance; tokens: ThemeTokens } {
  const theme = parseThemeId(themeId);
  const systemDark =
    options?.systemDark ??
    (typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true);
  const resolved = resolveAppearance(appearance, systemDark);
  const tokens = themeTokens(theme, resolved);
  const root = options?.root;
  if (root) {
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-appearance", resolved);
    root.style.colorScheme = resolved;
  }
  options?.themeColorMeta?.setAttribute("content", tokens.bg);
  return { theme, resolved, tokens };
}

export function buildThemeBootstrapScript(): string {
  const known = JSON.stringify(Object.fromEntries(THEME_IDS.map((id) => [id, 1])));
  return `(function(){try{var known=${known};var theme="${DEFAULT_THEME}";var appearance="${DEFAULT_APPEARANCE}";var raw=localStorage.getItem("${SETTINGS_STORAGE_KEY}");if(raw){var parsed=JSON.parse(raw);var s=parsed.state||parsed;if(known[s.theme])theme=s.theme;if(s.appearance==="light"||s.appearance==="dark"||s.appearance==="system")appearance=s.appearance;}var dark=appearance==="dark"||(appearance!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var el=document.documentElement;el.setAttribute("data-theme",theme);el.setAttribute("data-appearance",dark?"dark":"light");el.style.colorScheme=dark?"dark":"light";}catch(e){var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme","${DEFAULT_THEME}");document.documentElement.setAttribute("data-appearance",d?"dark":"light");document.documentElement.style.colorScheme=d?"dark":"light";}})();`;
}

export const THEME_BOOTSTRAP_SCRIPT = buildThemeBootstrapScript();
