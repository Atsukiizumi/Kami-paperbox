import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPEARANCES,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME,
  SETTINGS_STORAGE_KEY,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_IDS,
  THEMES,
  applyDocumentTheme,
  isHexColor,
  parseAppearance,
  parseThemeId,
  readStoredTheme,
  resolveAppearance,
  themeTokens,
} from "./theme.ts";

describe("theme catalog", () => {
  it("ships five named palettes with light and dark hex tokens", () => {
    assert.equal(THEME_IDS.length, 5);
    assert.equal(DEFAULT_THEME, "washi");
    assert.equal(DEFAULT_APPEARANCE, "dark");
    for (const id of THEME_IDS) {
      const def = THEMES[id];
      assert.equal(def.id, id);
      assert.ok(def.name);
      assert.ok(def.description);
      for (const mode of ["light", "dark"] as const) {
        const tokens = def[mode];
        for (const value of Object.values(tokens)) {
          assert.equal(isHexColor(value), true, `${id}.${mode} ${value}`);
        }
      }
    }
  });

  it("keeps washi dark as the original atelier palette", () => {
    assert.deepEqual(THEMES.washi.dark, {
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
    });
  });
});

describe("theme parsers", () => {
  it("falls back on unknown ids", () => {
    assert.equal(parseThemeId("nope"), DEFAULT_THEME);
    assert.equal(parseThemeId(null), DEFAULT_THEME);
    assert.equal(parseThemeId("koke"), "koke");
    assert.equal(parseAppearance("sepia"), DEFAULT_APPEARANCE);
    assert.equal(parseAppearance("light"), "light");
  });

  it("resolves system against the OS preference", () => {
    assert.equal(resolveAppearance("light", true), "light");
    assert.equal(resolveAppearance("dark", false), "dark");
    assert.equal(resolveAppearance("system", true), "dark");
    assert.equal(resolveAppearance("system", false), "light");
  });
});

describe("stored theme", () => {
  it("reads zustand persist payloads", () => {
    assert.deepEqual(readStoredTheme(null), {
      theme: DEFAULT_THEME,
      appearance: DEFAULT_APPEARANCE,
    });
    assert.deepEqual(
      readStoredTheme(
        JSON.stringify({ state: { theme: "shusha", appearance: "light" }, version: 4 }),
      ),
      { theme: "shusha", appearance: "light" },
    );
    assert.deepEqual(readStoredTheme("{not json"), {
      theme: DEFAULT_THEME,
      appearance: DEFAULT_APPEARANCE,
    });
    assert.deepEqual(
      readStoredTheme(JSON.stringify({ theme: "aosumi", appearance: "dark" })),
      { theme: "aosumi", appearance: "dark" },
    );
  });
});

describe("applyDocumentTheme", () => {
  it("writes data attributes and theme-color", () => {
    const attrs: Record<string, string> = {};
    const style: { colorScheme: string } = { colorScheme: "" };
    const root = {
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      style,
    } as unknown as HTMLElement;
    const meta = { content: "" };
    const result = applyDocumentTheme("koke", "light", {
      root,
      systemDark: true,
      themeColorMeta: {
        setAttribute(_name, value) {
          meta.content = value;
        },
      },
    });
    assert.equal(result.theme, "koke");
    assert.equal(result.resolved, "light");
    assert.equal(attrs["data-theme"], "koke");
    assert.equal(attrs["data-appearance"], "light");
    assert.equal(style.colorScheme, "light");
    assert.equal(meta.content, THEMES.koke.light.bg);
    assert.equal(themeTokens("washi", "dark").bg, "#0e0d0c");
  });
});

describe("theme bootstrap script", () => {
  it("inlines every theme id and the settings key", () => {
    for (const id of THEME_IDS) {
      assert.ok(THEME_BOOTSTRAP_SCRIPT.includes(id));
    }
    assert.ok(THEME_BOOTSTRAP_SCRIPT.includes(SETTINGS_STORAGE_KEY));
    for (const appearance of APPEARANCES) {
      assert.ok(THEME_BOOTSTRAP_SCRIPT.includes(appearance));
    }
  });

  it("keeps CSS palettes in sync with the catalog", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    for (const id of THEME_IDS) {
      for (const mode of ["light", "dark"] as const) {
        const selector = `html[data-theme="${id}"][data-appearance="${mode}"]`;
        assert.ok(css.includes(selector), selector);
        const tokens = THEMES[id][mode];
        assert.ok(css.includes(`--color-bg: ${tokens.bg}`), `${id}.${mode} bg`);
        assert.ok(css.includes(`--color-accent: ${tokens.accent}`), `${id}.${mode} accent`);
        assert.ok(css.includes(`--color-fg: ${tokens.fg}`), `${id}.${mode} fg`);
      }
    }
  });
});
